import { WdaService } from './service';
import { CaptureResult, DeviceRecord, HealthStatus, WdaOptions } from './types';

export type WdaBridge = {
  listDevices(): Promise<DeviceRecord[]>;
  health(): Promise<HealthStatus>;
  capture(deviceId: string): Promise<CaptureResult>;
};

export function createWdaBridge(opts: WdaOptions = {}): WdaBridge {
  const service = new WdaService(opts);
  return {
    listDevices: () => service.listDevices(),
    health: () => service.health(),
    capture: (deviceId: string) => service.capture(deviceId)
  };
}

export async function withBridge<T>(
  opts: WdaOptions,
  fn: (bridge: WdaBridge) => Promise<T>
): Promise<T> {
  const bridge = createWdaBridge(opts);
  return fn(bridge);
}
