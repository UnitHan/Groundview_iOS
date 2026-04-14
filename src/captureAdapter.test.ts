import { describe, expect, it, vi } from 'vitest';
import { WdaBridge } from './bridge';
import { captureAndNormalize, normalizeCaptureResult } from './captureAdapter';

describe('normalizeCaptureResult', () => {
  it('fills defaults and status', () => {
    const normalized = normalizeCaptureResult(
      'device-1',
      { screenshotPath: '/tmp/s.png', xmlPath: '/tmp/ui.xml' },
      { host: '10.0.0.1', port: 8200 },
      123
    );
    expect(normalized.platform).toBe('ios');
    expect(normalized.host).toBe('10.0.0.1');
    expect(normalized.port).toBe(8200);
    expect(normalized.status).toBe('ok');
    expect(normalized.timestamp).toBe(123);
  });

  it('marks errors', () => {
    const normalized = normalizeCaptureResult(
      'device-1',
      { screenshotPath: '', xmlPath: '', error: 'boom' },
      {},
      42
    );
    expect(normalized.status).toBe('error');
    expect(normalized.error).toBe('boom');
  });
});

describe('captureAndNormalize', () => {
  it('logs success and returns normalized payload', async () => {
    const log = vi.fn();
    const bridge: WdaBridge = {
      capture: vi.fn().mockResolvedValue({ screenshotPath: '/tmp/a.png', xmlPath: '/tmp/a.xml' }),
      listDevices: vi.fn(),
      health: vi.fn()
    };
    const result = await captureAndNormalize('abc', { host: '127.0.0.1' }, { bridge, now: () => 55, log });
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBe(55);
    expect(log).toHaveBeenCalled();
  });

  it('logs exception and returns error payload', async () => {
    const log = vi.fn();
    const bridge: WdaBridge = {
      capture: vi.fn().mockRejectedValue(new Error('timeout')),
      listDevices: vi.fn(),
      health: vi.fn()
    };
    const result = await captureAndNormalize('abc', {}, { bridge, now: () => 99, log });
    expect(result.status).toBe('error');
    expect(result.error).toContain('timeout');
    expect(log).toHaveBeenCalled();
  });

  it('retries when capture returns error', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const bridge: WdaBridge = {
      capture: vi
        .fn()
        .mockResolvedValueOnce({ screenshotPath: '', xmlPath: '', error: 'fail1' })
        .mockResolvedValueOnce({ screenshotPath: '/ok.png', xmlPath: '/ok.xml' } as any),
      listDevices: vi.fn(),
      health: vi.fn()
    };
    const promise = captureAndNormalize('abc', { retries: 1, retryDelayMs: 10 }, { bridge, now: () => 1, log });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('ok');
    expect(bridge.capture).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
