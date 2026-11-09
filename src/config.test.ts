import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadLauncherConfig, loadWdaConfig } from './config';

let directory: string;
let configPath: string;
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'groundview-config-'));
  configPath = path.join(directory, 'wda.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', originalPlatform);
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('loadWdaConfig', () => {
  it('parses numeric env vars and log file independently of local settings', () => {
    const cfg = loadWdaConfig({
      WDA_CONFIG: configPath, WDA_HOST: '10.0.0.5', WDA_PORT: '8200',
      WDA_TIMEOUT_MS: '15000', WDA_RETRIES: '2', WDA_RETRY_DELAY_MS: '500',
      WDA_LOG_FILE: '/tmp/wda.log'
    });
    expect(cfg.options).toEqual({ host: '10.0.0.5', port: 8200, timeoutMs: 15000, retries: 2, retryDelayMs: 500 });
    expect(cfg.logFile).toBe('/tmp/wda.log');
  });

  it('ignores invalid environment numbers when no config file exists', () => {
    expect(loadWdaConfig({ WDA_CONFIG: configPath, WDA_PORT: 'abc' }).options.port).toBeUndefined();
  });

  it('preserves the file value when an environment number is invalid', () => {
    fs.writeFileSync(configPath, JSON.stringify({ port: 9000 }));
    expect(loadWdaConfig({ WDA_CONFIG: configPath, WDA_PORT: 'abc' }).options.port).toBe(9000);
  });

  it('merges config file with env overrides', () => {
    fs.writeFileSync(configPath, JSON.stringify({ host: '1.1.1.1', port: 9000, retries: 2, logFile: '/tmp/file.log' }));
    const cfg = loadWdaConfig({ WDA_CONFIG: configPath, WDA_PORT: '8101' });
    expect(cfg.options).toEqual({ host: '1.1.1.1', port: 8101, retries: 2 });
    expect(cfg.logFile).toBe('/tmp/file.log');
  });
});

describe.each(['darwin', 'win32'])('launcher tool resolution on %s', (platform) => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  });

  it('falls back to PATH when a configured tool belongs to another machine', () => {
    fs.writeFileSync(configPath, JSON.stringify({ launcher: { pymobiledevice3Path: '/missing-machine/venv/pymobiledevice3' } }));
    const exists = fs.existsSync.bind(fs);
    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => String(candidate) === configPath && exists(candidate));
    expect(loadLauncherConfig({ WDA_CONFIG: configPath }).pymobiledevice3Path).toBe('pymobiledevice3');
  });

  it('prefers the project tool when available', () => {
    const tool = path.resolve(__dirname, '..', ...(platform === 'win32'
      ? ['win', 'tools', 'pymobiledevice3.exe'] : ['.venv', 'bin', 'pymobiledevice3']));
    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => String(candidate) === tool);
    expect(loadLauncherConfig({ WDA_CONFIG: configPath }).pymobiledevice3Path).toBe(tool);
  });

  it('honors an explicit environment override even before it exists', () => {
    expect(loadLauncherConfig({ WDA_CONFIG: configPath, PYMOBILEDEVICE3_PATH: '/custom/tool' }).pymobiledevice3Path).toBe('/custom/tool');
  });

  it('accepts a configured command resolved through PATH', () => {
    fs.writeFileSync(configPath, JSON.stringify({ launcher: { pymobiledevice3Path: 'custom-pmd3' } }));
    expect(loadLauncherConfig({ WDA_CONFIG: configPath }).pymobiledevice3Path).toBe('custom-pmd3');
  });
});
