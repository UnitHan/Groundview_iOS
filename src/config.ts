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

// Launcher config: paths + ports for the "WDA 실행" button. Values come from
// wda.config.json ("launcher" block) or env, with sensible macOS defaults.
export function loadLauncherConfig(env: NodeJS.ProcessEnv = process.env): LauncherConfig {
  const wda = loadWdaConfig(env);
  const fileBlock = launcherBlockFromFile(env.WDA_CONFIG || 'wda.config.json');
  const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const isWin = process.platform === 'win32';
  // Platform-aware defaults. On Windows, expect the bundled/-on-PATH .exe tools
  // (the all-in-one installer drops pymobiledevice3.exe / ios.exe next to the app);
  // on macOS, the paths verified in this repo.
  const defPmd3 = isWin ? 'pymobiledevice3' : '/Users/qabulls/Appkium_ixiO_Caller/.venv/bin/pymobiledevice3';
  const defIproxy = isWin ? 'iproxy' : '/opt/homebrew/bin/iproxy';
  const defIos = isWin ? 'ios' : 'ios';
  return {
    pymobiledevice3Path: env.PYMOBILEDEVICE3_PATH || fileBlock.pymobiledevice3Path || defPmd3,
    iproxyPath: env.IPROXY_PATH || fileBlock.iproxyPath || defIproxy,
    iosPath: env.GO_IOS_PATH || fileBlock.iosPath || defIos,
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
