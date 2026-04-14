import { createWdaBridge, WdaBridge } from './bridge';
import { CaptureResult, WdaOptions } from './types';

export type NormalizedCapture = {
  platform: 'ios';
  deviceId: string;
  screenshotPath: string;
  xmlPath?: string;
  status: 'ok' | 'error';
  error?: string;
  host: string;
  port: number;
  timestamp: number;
};

type Deps = {
  bridge?: WdaBridge;
  now?: () => number;
  log?: (line: string) => void;
};

export function normalizeCaptureResult(
  deviceId: string,
  capture: CaptureResult,
  opts: WdaOptions = {},
  timestamp = Date.now()
): NormalizedCapture {
  const host = opts.host || '127.0.0.1';
  const port = opts.port ?? 8100;
  return {
    platform: 'ios',
    deviceId,
    screenshotPath: capture.screenshotPath,
    xmlPath: capture.xmlPath,
    status: capture.error ? 'error' : 'ok',
    error: capture.error,
    host,
    port,
    timestamp
  };
}

export async function captureAndNormalize(
  deviceId: string,
  opts: WdaOptions = {},
  deps: Deps = {}
): Promise<NormalizedCapture> {
  const bridge = deps.bridge || createWdaBridge(opts);
  const log = deps.log || (() => {});
  const now = deps.now ? deps.now() : Date.now();
  const retries = opts.retries ?? 0;
  const retryDelay = opts.retryDelayMs ?? 200;

  const attempt = async (remaining: number): Promise<NormalizedCapture> => {
    try {
      const capture = await bridge.capture(deviceId);
      const normalized = normalizeCaptureResult(deviceId, capture, opts, now);
      if (normalized.status === 'error') {
        log(`capture failed device=${deviceId} host=${normalized.host}:${normalized.port} ${normalized.error}`);
        if (remaining > 0) {
          await new Promise((r) => setTimeout(r, retryDelay));
          return attempt(remaining - 1);
        }
      } else {
        log(`capture ok device=${deviceId} screenshot=${normalized.screenshotPath}`);
      }
      return normalized;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`capture exception device=${deviceId} ${message}`);
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, retryDelay));
        return attempt(remaining - 1);
      }
      return normalizeCaptureResult(deviceId, { screenshotPath: '', xmlPath: '', error: message }, opts, now);
    }
  };

  return attempt(retries);
}
