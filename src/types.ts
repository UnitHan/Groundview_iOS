export type DeviceKind = 'real' | 'simulator' | 'unknown';
export type ConnectionType = 'usb' | 'wifi' | 'unknown';

export interface DeviceRecord {
  id: string;
  name?: string;
  osVersion?: string;
  kind?: DeviceKind;
  platform: 'ios';
  connectionType?: ConnectionType;
  ipAddress?: string;
}

export interface CaptureResult {
  screenshotPath: string;
  xmlPath?: string;
  error?: string;
}

export interface HealthStatus {
  ok: boolean;
  details?: string;
}

export interface WdaOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

export interface DeviceService {
  platform: 'ios';
  listDevices(): Promise<DeviceRecord[]>;
  capture(deviceId: string): Promise<CaptureResult>;
  health(): Promise<HealthStatus>;
}
