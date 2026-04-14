#!/usr/bin/env node
import { createWdaBridge } from './bridge';
import { captureAndNormalize } from './captureAdapter';
import { loadWdaConfig } from './config';
import { createFileLogger, combineLoggers } from './logging';
import { CaptureResult, DeviceRecord, HealthStatus, WdaOptions, CaptureResult as Normalized } from './types';

type Command = 'list' | 'health' | 'capture';

type ParsedArgs = {
  command?: Command;
  opts: WdaOptions;
  deviceId?: string;
  json?: boolean;
  logFile?: string;
};

function usage(): string {
  return [
    'Usage:',
    '  node dist/cli.js list [--json] [--host 127.0.0.1] [--port 8100] [--timeout 10000] [--retries 1] [--retry-delay 200]',
    '  node dist/cli.js health [--json] [--host 127.0.0.1] [--port 8100] [--timeout 10000] [--retries 1] [--retry-delay 200]',
    '  node dist/cli.js capture --device <udid> [--json] [--host 127.0.0.1] [--port 8100] [--timeout 10000] [--retries 1] [--retry-delay 200] [--log path]',
    '',
    'Flags:',
    '  --host <ip>       WDA host (default 127.0.0.1)',
    '  --port <port>     WDA port (default 8100)',
    '  --timeout <ms>    Request timeout in ms (default 10000)',
    '  --retries <n>     Retry attempts on capture/source/screenshot (default 0)',
    '  --retry-delay <ms> Delay between retries in ms (default 200)',
    '  --device, -d      Device UDID (required for capture)',
    '  --json            Print JSON output',
    '  --log <path>      Append logs to file (capture only)'
  ].join('\n');
}

function parseNumberFlag(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`${flag} requires a value`);
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new Error(`${flag} must be a number`);
  return parsed;
}

function parseArgs(argv: string[], baseOpts: WdaOptions = {}): ParsedArgs {
  const parsed: ParsedArgs = { opts: { ...baseOpts }, json: false };
  let idx = 0;
  while (idx < argv.length) {
    const arg = argv[idx];
    if (!parsed.command && (arg === 'list' || arg === 'health' || arg === 'capture')) {
      parsed.command = arg;
      idx += 1;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      idx += 1;
      continue;
    }
    if (arg === '--host') {
      parsed.opts.host = argv[idx + 1];
      idx += 2;
      continue;
    }
    if (arg === '--port') {
      parsed.opts.port = parseNumberFlag(argv[idx + 1], '--port');
      idx += 2;
      continue;
    }
    if (arg === '--timeout') {
      parsed.opts.timeoutMs = parseNumberFlag(argv[idx + 1], '--timeout');
      idx += 2;
      continue;
    }
    if (arg === '--device' || arg === '-d') {
      parsed.deviceId = argv[idx + 1];
      idx += 2;
      continue;
    }
    if (arg === '--retries') {
      parsed.opts.retries = parseNumberFlag(argv[idx + 1], '--retries');
      idx += 2;
      continue;
    }
    if (arg === '--retry-delay') {
      parsed.opts.retryDelayMs = parseNumberFlag(argv[idx + 1], '--retry-delay');
      idx += 2;
      continue;
    }
    if (arg === '--log') {
      parsed.logFile = argv[idx + 1];
      idx += 2;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function formatDevices(devices: DeviceRecord[]): string {
  if (!devices.length) return 'No iOS devices detected.';
  return devices
    .map((d) => {
      const parts = [
        d.name || d.id,
        d.osVersion ? `iOS ${d.osVersion}` : 'iOS',
        d.kind || 'unknown',
        `id=${d.id}`
      ];
      return `- ${parts.join(' | ')}`;
    })
    .join('\n');
}

function formatHealth(health: HealthStatus): string {
  return `${health.ok ? 'OK' : 'FAIL'} ${health.details || ''}`.trim();
}

function formatCapture(cap: CaptureResult): string {
  if (cap.error) {
    return `Capture failed: ${cap.error}`;
  }
  const xml = cap.xmlPath || 'n/a';
  return `Capture saved. screenshot=${cap.screenshotPath} xml=${xml}`;
}

function formatNormalizedCapture(cap: Normalized & { status?: string }): string {
  if ((cap as any).status && (cap as any).status !== 'ok') {
    return `Capture failed: ${cap.error || 'unknown error'}`;
  }
  const xml = (cap as any).xmlPath || 'n/a';
  const status = (cap as any).status || (cap as any).error ? 'error' : 'ok';
  const host = (cap as any).host ? `${(cap as any).host}:${(cap as any).port}` : '';
  return `Capture ${status}. screenshot=${cap.screenshotPath} xml=${xml} ${host}`.trim();
}

async function run(command: Command, parsed: ParsedArgs) {
  const bridge = createWdaBridge(parsed.opts);
  if (command === 'list') {
    const devices = await bridge.listDevices();
    return parsed.json ? JSON.stringify(devices, null, 2) : formatDevices(devices);
  }
  if (command === 'health') {
    const health = await bridge.health();
    return parsed.json ? JSON.stringify(health, null, 2) : formatHealth(health);
  }
  if (command === 'capture') {
    if (!parsed.deviceId) throw new Error('capture requires --device <udid>');
    const loggers = parsed.logFile ? [createFileLogger(parsed.logFile)] : [];
    const cap = await captureAndNormalize(parsed.deviceId, parsed.opts, {
      log: loggers.length ? combineLoggers(...loggers) : undefined
    });
    return parsed.json ? JSON.stringify(cap, null, 2) : formatNormalizedCapture(cap as any);
  }
  throw new Error(`Unsupported command: ${command}`);
}

async function main() {
  try {
    const base = loadWdaConfig();
    const parsed = parseArgs(process.argv.slice(2), base.options);
    if (!parsed.logFile) parsed.logFile = base.logFile;
    if (!parsed.command) {
      console.error(usage());
      process.exitCode = 1;
      return;
    }
    const output = await run(parsed.command, parsed);
    console.log(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  }
}

void main();
