import { describe, expect, it, vi } from 'vitest';
import { WdaBridge } from './bridge';
import { fetchReadyCardState } from './onboarding';

describe('fetchReadyCardState', () => {
  it('aggregates health and devices on mac', async () => {
    const bridge: WdaBridge = {
      listDevices: vi.fn().mockResolvedValue([{ id: 'A', platform: 'ios' }]),
      health: vi.fn().mockResolvedValue({ ok: true, details: 'ready' }),
      capture: vi.fn()
    };
    const state = await fetchReadyCardState(
      { host: '10.0.0.1', port: 9999 },
      { bridge, now: () => 123, isMacFn: () => true }
    );
    expect(state.macOS).toBe(true);
    expect(state.host).toBe('10.0.0.1');
    expect(state.port).toBe(9999);
    expect(state.health.ok).toBe(true);
    expect(state.devices).toHaveLength(1);
    expect(state.timestamp).toBe(123);
    expect(bridge.listDevices).toHaveBeenCalled();
    expect(bridge.health).toHaveBeenCalled();
  });

  it('returns guard state on non-mac', async () => {
    const state = await fetchReadyCardState({}, { isMacFn: () => false, now: () => 42 });
    expect(state.macOS).toBe(false);
    expect(state.health.ok).toBe(false);
    expect(state.devices).toEqual([]);
    expect(state.timestamp).toBe(42);
    expect(state.note).toContain('macOS');
  });
});
