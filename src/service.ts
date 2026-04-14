import { DeviceService, CaptureResult, HealthStatus, WdaOptions } from './types';
import { listDevices, isMac } from './deviceList';
import { WdaClient } from './wdaClient';

type DeviceListFn = typeof listDevices;

type Deps = {
  client?: WdaClient;
  listFn?: DeviceListFn;
  isMac?: () => boolean;
};

export class WdaService implements DeviceService {
  platform: 'ios' = 'ios';
  private client: WdaClient;
  private listFn: DeviceListFn;
  private isMacFn: () => boolean;

  constructor(opts: WdaOptions = {}, deps: Deps = {}) {
    this.client = deps.client || new WdaClient(opts);
    this.listFn = deps.listFn || listDevices;
    this.isMacFn = deps.isMac || isMac;
  }

  async listDevices() {
    if (!this.isMacFn()) return [];
    return this.listFn();
  }

  async capture(_deviceId: string): Promise<CaptureResult> {
    if (!this.isMacFn()) {
      return { screenshotPath: '', xmlPath: '', error: 'WDA capture requires macOS' };
    }
    return this.client.capture();
  }

  async health(): Promise<HealthStatus> {
    if (!this.isMacFn()) return { ok: false, details: 'WDA available on macOS only' };
    return this.client.health();
  }
}
