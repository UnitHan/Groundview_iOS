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

  // Device discovery and WDA I/O are cross-platform: listDevices() picks the
  // per-OS backend (xctrace on macOS, pymobiledevice3 on Windows) and capture/
  // health talk plain HTTP to WDA (127.0.0.1 over iproxy, or the device LAN IP
  // when wireless). No macOS gate — Windows drives the same WDA endpoints.
  async listDevices() {
    return this.listFn();
  }

  async capture(_deviceId: string): Promise<CaptureResult> {
    return this.client.capture();
  }

  async health(): Promise<HealthStatus> {
    return this.client.health();
  }
}
