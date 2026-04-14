import { createWdaBridge, WdaBridge } from './bridge';
import { isMac } from './deviceList';
import { DeviceRecord, HealthStatus, WdaOptions } from './types';

export type ReadyCardState = {
  macOS: boolean;
  host: string;
  port: number;
  health: HealthStatus;
  devices: DeviceRecord[];
  timestamp: number;
  note?: string;
};

type Deps = {
  bridge?: WdaBridge;
  now?: () => number;
  isMacFn?: () => boolean;
};

export async function fetchReadyCardState(
  opts: WdaOptions = {},
  deps: Deps = {}
): Promise<ReadyCardState> {
  const mac = deps.isMacFn ? deps.isMacFn() : isMac();
  const bridge = deps.bridge || createWdaBridge(opts);
  const now = deps.now ? deps.now() : Date.now();
  const host = opts.host || '127.0.0.1';
  const port = opts.port ?? 8100;

  if (!mac) {
    return {
      macOS: false,
      host,
      port,
      health: { ok: false, details: 'macOS only' },
      devices: [],
      timestamp: now,
      note: 'iOS 캡처는 macOS에서만 동작합니다.'
    };
  }

  const [health, devices] = await Promise.all([bridge.health(), bridge.listDevices()]);
  return {
    macOS: mac,
    host,
    port,
    health,
    devices,
    timestamp: now
  };
}
