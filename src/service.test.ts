import { describe, expect, it, vi } from 'vitest';
import { WdaService } from './service';
import { CaptureResult, HealthStatus } from './types';

describe('WdaService', () => {
  it('returns empty/device error on non-mac without calling deps', async () => {
    const listFn = vi.fn();
    const client = {
      capture: vi.fn(),
      health: vi.fn()
    };
    const svc = new WdaService(
      {},
      { listFn, client: client as any, isMac: () => false }
    );
    expect(await svc.listDevices()).toEqual([]);
    const cap = await svc.capture('dummy');
    expect(cap.error).toContain('macOS');
    const health = await svc.health();
    expect(health.ok).toBe(false);
    expect(listFn).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.health).not.toHaveBeenCalled();
  });

  it('delegates to WDA client on mac', async () => {
    const listResult = [{ id: 'A', platform: 'ios' as const }];
    const listFn = vi.fn().mockResolvedValue(listResult);
    const capResult: CaptureResult = { screenshotPath: '/tmp/shot.png', xmlPath: '/tmp/ui.xml' };
    const healthResult: HealthStatus = { ok: true, details: 'ready' };
    const client = {
      capture: vi.fn().mockResolvedValue(capResult),
      health: vi.fn().mockResolvedValue(healthResult)
    };
    const svc = new WdaService({}, { listFn, client: client as any, isMac: () => true });
    expect(await svc.listDevices()).toEqual(listResult);
    expect(await svc.capture('A')).toEqual(capResult);
    expect(await svc.health()).toEqual(healthResult);
    expect(listFn).toHaveBeenCalledTimes(1);
    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(client.health).toHaveBeenCalledTimes(1);
  });
});
