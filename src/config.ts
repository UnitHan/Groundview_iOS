import fs from 'fs';
import path from 'path';
import { WdaOptions } from './types';
import type { LauncherConfig } from './wdaLauncher';

function parseNum(val?: string): number | undefined {
  if (!val) return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

export type WdaConfig = {
  options: WdaOptions;
  logFile?: string;
};

export function loadWdaConfig(env: NodeJS.ProcessEnv = process.env): WdaConfig {
  const fromEnv = configFromEnv(env);
  const configPath = env.WDA_CONFIG || 'wda.config.json';
  const fromFile = configFromFile(configPath);
  return {
    options: { ...fromFile.options, ...fromEnv.options },
    logFile: fromEnv.logFile || fromFile.logFile
  };
}

function configFromEnv(env: NodeJS.ProcessEnv): WdaConfig {
  const host = env.WDA_HOST;
  const port = parseNum(env.WDA_PORT);
  const timeoutMs = parseNum(env.WDA_TIMEOUT_MS);
  const retries = parseNum(env.WDA_RETRIES);
  const retryDelayMs = parseNum(env.WDA_RETRY_DELAY_MS);
  const logFile = env.WDA_LOG_FILE || env.GROUNDVIEW_WDA_LOG;
  const options: WdaOptions = {};
  if (host) options.host = host;
  if (port !== undefined) options.port = port;
  if (timeoutMs !== undefined) options.timeoutMs = timeoutMs;
  if (retries !== undefined) options.retries = retries;
  if (retryDelayMs !== undefined) options.retryDelayMs = retryDelayMs;
  return { options, logFile: logFile || undefined };
}

// First existing path among candidates, else the last candidate (fallback that
// resolves through PATH). Lets a platform-specific config value be ignored on a
// platform where it doesn't exist (e.g. a macOS pymobiledevice3 path on Windows).
function firstExisting(candidates: Array<string | undefined>, fallback: string): string {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  // If an explicit value was given but doesn't exist as a file, still honour it
  // (it may resolve through PATH); otherwise use the fallback.
  const explicit = candidates.find((c) => !!c);
  return explicit || fallback;
}

// Candidate locations for a bundled Windows .exe tool, tried in order:
//   1) <resourcesPath>\win\tools\<name>  (packaged app: extraResources land here,
//      OUTSIDE app.asar — process.resourcesPath is the only correct base)
//   2) resources\win\tools\<name>        (repo/dev layout relative to project root)
//   3) .venv\Scripts\<name>              (dedicated dev virtualenv, see WINDOWS_TODO)
function winBundledCandidates(name: string): string[] {
  const root = path.resolve(__dirname, '..'); // dist/ -> project root (dev)
  const cands: string[] = [];
  // Packaged Electron app: extraResources (win/) are copied to
  // <install>\resources\win, i.e. process.resourcesPath\win — never inside asar.
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  if (resourcesPath) {
    cands.push(path.join(resourcesPath, 'win', 'tools', name));
  }
  cands.push(path.join(root, 'resources', 'win', 'tools', name));
  cands.push(path.join(root, '.venv', 'Scripts', name));
  return cands;
}

// Launcher config: paths + ports for the "WDA 실행" button. Values come from
// wda.config.json ("launcher" block) or env, with sensible per-OS defaults.
export function loadLauncherConfig(env: NodeJS.ProcessEnv = process.env): LauncherConfig {
  const wda = loadWdaConfig(env);
  const fileBlock = launcherBlockFromFile(env.WDA_CONFIG || 'wda.config.json');
  const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const isWin = process.platform === 'win32';
  // Platform-aware defaults. On Windows, prefer a bundled/venv pymobiledevice3.exe
  // and fall back to PATH; the config file's macOS paths are skipped when absent.
  let pymobiledevice3Path: string;
  let iproxyPath: string;
  let iosPath: string;
  if (isWin) {
    pymobiledevice3Path = firstExisting(
      [env.PYMOBILEDEVICE3_PATH, fileBlock.pymobiledevice3Path, ...winBundledCandidates('pymobiledevice3.exe')],
      'pymobiledevice3'
    );
    iproxyPath = env.IPROXY_PATH || fileBlock.iproxyPath || 'iproxy';
    iosPath = firstExisting(
      [env.GO_IOS_PATH, fileBlock.iosPath, ...winBundledCandidates('ios.exe')],
      'ios'
    );
  } else {
    pymobiledevice3Path = env.PYMOBILEDEVICE3_PATH || fileBlock.pymobiledevice3Path || '/Users/qabulls/Appkium_ixiO_Caller/.venv/bin/pymobiledevice3';
    iproxyPath = env.IPROXY_PATH || fileBlock.iproxyPath || '/opt/homebrew/bin/iproxy';
    iosPath = env.GO_IOS_PATH || fileBlock.iosPath || 'ios';
  }
  return {
    pymobiledevice3Path,
    iproxyPath,
    iosPath,
    tunneldHost: env.TUNNELD_HOST || fileBlock.tunneldHost || '127.0.0.1',
    tunneldPort: num(env.TUNNELD_PORT || fileBlock.tunneldPort, 49151),
    wdaPort: num(env.WDA_PORT || fileBlock.wdaPort || wda.options.port, 8100),
    mjpegPort: num(env.MJPEG_SERVER_PORT || fileBlock.mjpegPort, 9100),
    runnerBundleId: env.WDA_RUNNER_BUNDLE_ID || fileBlock.runnerBundleId || undefined,
    readyTimeoutMs: num(env.WDA_READY_TIMEOUT_MS || fileBlock.readyTimeoutMs, 60000),
  };
}

function launcherBlockFromFile(configPath: string): Record<string, any> {
  try {
    const target = path.resolve(configPath);
    if (!fs.existsSync(target)) return {};
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    return (parsed && typeof parsed.launcher === 'object' && parsed.launcher) || {};
  } catch {
    return {};
  }
}

function configFromFile(configPath: string): WdaConfig {
  try {
    const target = path.resolve(configPath);
    if (!fs.existsSync(target)) return { options: {} };
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw);
    const options: WdaOptions = {};
    if (parsed.host) options.host = parsed.host;
    if (parsed.port !== undefined) options.port = Number(parsed.port);
    if (parsed.timeoutMs !== undefined) options.timeoutMs = Number(parsed.timeoutMs);
    if (parsed.retries !== undefined) options.retries = Number(parsed.retries);
    if (parsed.retryDelayMs !== undefined) options.retryDelayMs = Number(parsed.retryDelayMs);
    return { options, logFile: parsed.logFile };
  } catch {
    return { options: {} };
  }
}
