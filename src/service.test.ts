import { describe, expect, it, vi } from 'vitest';
import { WdaService } from './service';
import { CaptureResult, HealthStatus } from './types';

describe('WdaService', () => {
  it('delegates device discovery, capture and health to cross-platform backends', async () => {
    const listResult = [{ id: 'A', platform: 'ios' as const }];
    const listFn = vi.fn().mockResolvedValue(listResult);
    const capResult: CaptureResult = { screenshotPath: '/tmp/shot.png', xmlPath: '/tmp/ui.xml' };
    const healthResult: HealthStatus = { ok: true, details: 'ready' };
    const client = {
      capture: vi.fn().mockResolvedValue(capResult),
      health: vi.fn().mockResolvedValue(healthResult)
    };
    const svc = new WdaService({}, { listFn, client: client as any });
    expect(await svc.listDevices()).toEqual(listResult);
    expect(await svc.capture('A')).toEqual(capResult);
    expect(await svc.health()).toEqual(healthResult);
    expect(listFn).toHaveBeenCalledTimes(1);
    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(client.health).toHaveBeenCalledTimes(1);
  });

  it('preserves backend failure details for the caller', async () => {
    const client = {
      capture: vi.fn().mockResolvedValue({ error: 'WDA unreachable' }),
      health: vi.fn().mockResolvedValue({ ok: false, details: 'Connection refused' })
    };
    const svc = new WdaService({}, {
      listFn: vi.fn().mockRejectedValue(new Error('Device discovery failed')),
      client: client as any
    });
    await expect(svc.listDevices()).rejects.toThrow('Device discovery failed');
    expect(await svc.capture('A')).toEqual({ error: 'WDA unreachable' });
    expect(await svc.health()).toEqual({ ok: false, details: 'Connection refused' });
  });
});
