import fs from 'fs';
import path from 'path';
import { WdaOptions } from './types';

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
