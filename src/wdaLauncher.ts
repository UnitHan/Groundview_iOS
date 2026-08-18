// WDA launcher for iOS 17+ devices that already have WebDriverAgent installed.
//
// Proven recipe (see sh/setup_wda_offline.sh, sh/open_wda_xcode.sh):
//   1. A RemoteXPC tunnel must exist (iOS 17.4+ requires root). We rely on a
//      persistent `pymobiledevice3 remote tunneld` daemon reachable over its
//      REST port (default 49151). This module never calls sudo itself.
//   2. Launch the already-installed XCUITest runner via testmanagerd/DDI:
//        pymobiledevice3 developer dvt xcuitest --tunnel <UDID> --env USE_PORT=<p> <runner>
//      No .ipa / .xctestrun / build products are needed to *launch* an
//      installed runner.
//   3. Forward the WDA HTTP port to localhost via iproxy so the rest of the
//      app can talk to http://127.0.0.1:<port>.
import http from 'http';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

export type LauncherConfig = {
  pymobiledevice3Path: string;
  iproxyPath: string;
  iosPath?: string; // go-ios (ios / ios.exe) — alternative tunnel/launch tool on Windows
  tunneldHost: string;
  tunneldPort: number;
  wdaPort: number;
  mjpegPort: number;
  runnerBundleId?: string; // optional override; auto-discovered when absent (macOS only)
  readyTimeoutMs: number;
};

export type TunnelInfo = { address: string; port: number; interface?: string };

function logDir(): string {
  return process.platform === 'darwin'
    ? path.join(os.homedir(), 'Documents', 'GroundView_log')
    : path.join(os.homedir(), 'GroundView_log');
}

function ensureLogDir(): string {
  const dir = logDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

// --- tunneld (RemoteXPC) --------------------------------------------------

function httpGetJson(url: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d) => chunks.push(typeof d === 'string' ? Buffer.from(d) : d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('tunneld request timeout')); });
  });
}

export async function getDeviceTunnel(udid: string, cfg: LauncherConfig): Promise<TunnelInfo | null> {
  try {
    const data = await httpGetJson(`http://${cfg.tunneldHost}:${cfg.tunneldPort}/`, 2500);
    const entry = data?.[udid];
    const first = Array.isArray(entry) ? entry[0] : entry;
    if (first && first['tunnel-address'] && first['tunnel-port']) {
      return {
        address: String(first['tunnel-address']),
        port: Number(first['tunnel-port']),
        interface: first['interface'],
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function isTunneldUp(cfg: LauncherConfig): Promise<boolean> {
  try {
    await httpGetJson(`http://${cfg.tunneldHost}:${cfg.tunneldPort}/`, 2000);
    return true;
  } catch {
    return false;
  }
}

// Re-resolve a wireless device's CURRENT LAN IP, keyed only by the (stable) UDID.
// Works in a dynamic-DHCP environment: the RemoteXPC tunnel address survives IP
// changes, and WDA's /status reports the device's live LAN IP (value.ios.ip).
// Chain: UDID -> tunneld REST -> tunnel-address -> GET /status -> ios.ip.
export async function resolveWirelessIp(
  udid: string,
  cfg: LauncherConfig
): Promise<{ ip: string; tunnel: TunnelInfo } | null> {
  const tunnel = await getDeviceTunnel(udid, cfg);
  if (!tunnel) return null;
  const st = await checkWdaStatus(tunnel.address, cfg.wdaPort, 2500);
  const ip = st.raw?.ios?.ip;
  if (st.ready && ip) return { ip: String(ip), tunnel };
  return null;
}

// --- WDA status -----------------------------------------------------------

export function checkWdaStatus(host: string, port: number, timeoutMs = 2000): Promise<{ ready: boolean; raw?: any }> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: host, port, path: '/status', method: 'GET', timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(typeof d === 'string' ? Buffer.from(d) : d));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const ready = parsed?.value?.ready === true || !!parsed?.value?.build;
            resolve({ ready, raw: parsed?.value });
          } catch {
            resolve({ ready: false });
          }
        });
      }
    );
    req.on('error', () => resolve({ ready: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ready: false }); });
    req.end();
  });
}

const IS_WIN = process.platform === 'win32';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// PIDs we spawned, keyed by udid — so stop/relaunch works cross-platform
// without relying on Unix-only `pkill` pattern matching.
const launchedPids = new Map<string, { dvt?: number; iproxy?: number }>();

function killPid(pid?: number): void {
  if (!pid) return;
  try { process.kill(pid); } catch { /* already gone */ }
}

// Best-effort kill of stray processes by command-line pattern. Unix-only
// (`pkill -f`); on Windows we rely on the tracked PIDs above instead.
function pkillPattern(pattern: string): Promise<void> {
  if (IS_WIN) return Promise.resolve();
  return execFileAsync('pkill', ['-f', pattern]).then(() => undefined).catch(() => undefined);
}

// --- runner bundle discovery ---------------------------------------------

// Pick the WebDriverAgent XCUITest runner bundle id from a list of candidate ids.
// Prefer `*.xctrunner` ids that mention WebDriverAgent; fall back to any xctrunner.
function pickRunnerBundleId(ids: string[]): string | null {
  const xctrunners = ids.filter((id) => /\.xctrunner$/i.test(id));
  return (
    xctrunners.find((id) => /webdriveragent/i.test(id)) ||
    xctrunners[0] ||
    null
  );
}

// Find the installed WebDriverAgent XCUITest runner bundle id.
// macOS: CoreDevice (devicectl) — uses system trust, no pymobiledevice3 pairing.
// Windows: pymobiledevice3 apps list (needs the tunnel/pairing that tunneld holds).
// If discovery fails, callers should set launcher.runnerBundleId in config.
export async function discoverRunnerBundleId(udid: string, pymobiledevice3Path?: string): Promise<string | null> {
  if (IS_WIN) {
    if (!pymobiledevice3Path) return null;
    try {
      const { stdout } = await execFileAsync(
        pymobiledevice3Path,
        ['apps', 'list', '-t', 'User', '--udid', udid],
        { timeout: 20000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8' } as any
      );
      const stdoutStr = String(stdout);
      const parsed = JSON.parse(stdoutStr.trim() || '{}');
      // apps list returns a dict keyed by bundle id.
      const ids = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
      return pickRunnerBundleId(ids);
    } catch {
      return null;
    }
  }
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', udid], {
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const line = stdout
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /\.xctrunner\b/.test(l) && /webdriveragent/i.test(l));
    if (!line) return null;
    const match = line.match(/([A-Za-z0-9._-]+\.xctrunner)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// --- process helpers ------------------------------------------------------

async function startIproxy(cfg: LauncherConfig, udid: string, logFile: string): Promise<void> {
  // iproxy forwards over usbmux (USB only). On Windows we go wireless-first and
  // reach WDA at the device LAN IP, so iproxy is skipped there. Also skip if the
  // configured binary is absent.
  if (IS_WIN) return;
  if (cfg.iproxyPath !== 'iproxy' && !fs.existsSync(cfg.iproxyPath)) return;
  await pkillPattern(`iproxy ${cfg.wdaPort}`);
  await sleep(300);
  const out = fs.openSync(logFile, 'a');
  const child = spawn(cfg.iproxyPath, [String(cfg.wdaPort), String(cfg.wdaPort), '-u', udid], {
    stdio: ['ignore', out, out],
    detached: true,
    windowsHide: true,
  });
  child.unref();
  const rec = launchedPids.get(udid) || {};
  rec.iproxy = child.pid;
  launchedPids.set(udid, rec);
}

// --- launch / stop --------------------------------------------------------

export type LaunchResult = {
  ok: boolean;
  ready: boolean;
  stage: 'tunneld' | 'runner' | 'launch' | 'ready';
  transport?: 'usb' | 'wireless';
  wdaUrl?: string;
  deviceIp?: string;
  bundleId?: string;
  tunnel?: TunnelInfo;
  logFile?: string;
  status?: any;
  error?: string;
  hint?: string;
};

function hostUrl(host: string, port: number): string {
  // wrap IPv6 (tunnel address) in brackets
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

export async function launchWda(
  udid: string,
  cfg: LauncherConfig,
  log: (m: string) => void = () => {}
): Promise<LaunchResult> {
  const dir = ensureLogDir();
  const wdaLog = path.join(dir, `wda-launch-${udid.slice(0, 8)}.log`);
  const iproxyLog = path.join(dir, `wda-iproxy-${udid.slice(0, 8)}.log`);

  // 1) tunneld preflight — never sudo from here.
  const tunnel = await getDeviceTunnel(udid, cfg);
  if (!tunnel) {
    const up = await isTunneldUp(cfg);
    log(`[wda] tunnel missing (tunneld ${up ? 'up' : 'down'})`);
    return {
      ok: false,
      ready: false,
      stage: 'tunneld',
      error: up
        ? `tunneld는 실행 중이나 이 기기(${udid.slice(0, 8)})의 터널이 없습니다. 기기 USB 연결/잠금 해제를 확인하세요.`
        : `RemoteXPC tunneld가 실행 중이 아닙니다 (:${cfg.tunneldPort}).`,
      hint: 'tunneld 상시 데몬을 설치하세요: sudo bash sh/install_tunneld_daemon.sh',
    };
  }
  log(`[wda] tunnel: ${tunnel.address}:${tunnel.port}`);

  // Already up? short-circuit.
  const pre = await checkWdaStatus('127.0.0.1', cfg.wdaPort, 1500);
  if (pre.ready) {
    log('[wda] already ready on 127.0.0.1');
    return { ok: true, ready: true, stage: 'ready', wdaUrl: `http://127.0.0.1:${cfg.wdaPort}`, tunnel, status: pre.raw, logFile: wdaLog };
  }

  // 2) resolve runner bundle id
  const runner = cfg.runnerBundleId || (await discoverRunnerBundleId(udid, cfg.pymobiledevice3Path));
  if (!runner) {
    return {
      ok: false,
      ready: false,
      stage: 'runner',
      tunnel,
      error: '설치된 WDA 러너(.xctrunner)를 찾지 못했습니다. wda.config.json의 launcher.runnerBundleId를 지정하세요.',
    };
  }
  log(`[wda] runner: ${runner}`);

  // 3) launch the installed runner via testmanagerd/DDI over the tunnel.
  killPid(launchedPids.get(udid)?.dvt);
  await pkillPattern(`developer dvt xcuitest.*${runner}`);
  await sleep(500);
  try {
    fs.writeFileSync(wdaLog, `=== WDA launch ${new Date().toISOString()} runner=${runner} ===\n`);
  } catch { /* ignore */ }
  const out = fs.openSync(wdaLog, 'a');
  const args = [
    'developer', 'dvt', 'xcuitest',
    '--tunnel', udid,
    '--env', `USE_PORT=${cfg.wdaPort}`,
    '--env', `MJPEG_SERVER_PORT=${cfg.mjpegPort}`,
    runner,
  ];
  const child = spawn(cfg.pymobiledevice3Path, args, {
    stdio: ['ignore', out, out],
    detached: true,
    windowsHide: true, // no console window flash in packaged builds
    env: { ...process.env },
  });
  child.unref();
  launchedPids.set(udid, { ...(launchedPids.get(udid) || {}), dvt: child.pid });
  log(`[wda] spawned pymobiledevice3 dvt xcuitest (pid=${child.pid})`);

  // 4) start iproxy so 127.0.0.1:<port> reaches WDA over USB (harmless no-op
  //    when the device is wireless — usbmux simply has no device to forward).
  await startIproxy(cfg, udid, iproxyLog);

  // 5) poll for readiness. The RemoteXPC tunnel address is the most reliable
  //    post-launch probe (works over USB and WiFi); once ready we pick the best
  //    reachable host: 127.0.0.1 (USB/iproxy) → device LAN IP (wireless) → tunnel.
  const deadline = Date.now() + cfg.readyTimeoutMs;
  let status: { ready: boolean; raw?: any } = { ready: false };
  let readyHost: string | null = null;
  let deviceIp: string | undefined;
  while (Date.now() < deadline) {
    const viaTunnel = await checkWdaStatus(tunnel.address, cfg.wdaPort, 1500);
    if (viaTunnel.ready) {
      status = viaTunnel;
      deviceIp = viaTunnel.raw?.ios?.ip;
      const local = await checkWdaStatus('127.0.0.1', cfg.wdaPort, 1200);
      if (local.ready) {
        readyHost = '127.0.0.1';
      } else if (deviceIp && (await checkWdaStatus(deviceIp, cfg.wdaPort, 1500)).ready) {
        readyHost = deviceIp;
      } else {
        readyHost = tunnel.address;
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (readyHost) {
    const transport: 'usb' | 'wireless' = readyHost === '127.0.0.1' ? 'usb' : 'wireless';
    log(`[wda] ready via ${readyHost} (${transport})`);
    return {
      ok: true, ready: true, stage: 'ready', transport,
      wdaUrl: hostUrl(readyHost, cfg.wdaPort),
      deviceIp,
      bundleId: runner, tunnel, status: status.raw, logFile: wdaLog,
    };
  }

  log('[wda] launch timed out waiting for /status');
  return {
    ok: false, ready: false, stage: 'launch',
    bundleId: runner, tunnel, logFile: wdaLog,
    error: `WDA 기동 후 ${Math.round(cfg.readyTimeoutMs / 1000)}s 내에 준비되지 않았습니다. 로그: ${wdaLog}`,
    hint: 'DDI(개발자 이미지) 마운트 여부와 기기 잠금 해제를 확인하세요.',
  };
}

export async function stopWda(udid: string, cfg: LauncherConfig): Promise<{ ok: boolean }> {
  const rec = launchedPids.get(udid);
  killPid(rec?.dvt);
  killPid(rec?.iproxy);
  launchedPids.delete(udid);
  const runner = cfg.runnerBundleId || (await discoverRunnerBundleId(udid, cfg.pymobiledevice3Path)) || 'WebDriverAgentRunner';
  await pkillPattern(`developer dvt xcuitest.*${runner}`);
  // testmanagerd-side kill works over the tunnel on any platform.
  await execFileAsync(cfg.pymobiledevice3Path, ['developer', 'dvt', 'pkill', 'WebDriverAgentRunner-Runner', '--tunnel', udid], { windowsHide: true } as any)
    .catch(() => undefined);
  await pkillPattern(`iproxy ${cfg.wdaPort}`);
  return { ok: true };
}

export async function launchStatus(udid: string, cfg: LauncherConfig): Promise<{
  tunneldUp: boolean;
  tunnel: TunnelInfo | null;
  wdaReady: boolean;
  runnerBundleId: string | null;
}> {
  const [tunnel, wda] = await Promise.all([
    getDeviceTunnel(udid, cfg),
    checkWdaStatus('127.0.0.1', cfg.wdaPort, 1200),
  ]);
  const tunneldUp = tunnel ? true : await isTunneldUp(cfg);
  const runnerBundleId = cfg.runnerBundleId || (await discoverRunnerBundleId(udid, cfg.pymobiledevice3Path));
  return { tunneldUp, tunnel, wdaReady: wda.ready, runnerBundleId };
}
