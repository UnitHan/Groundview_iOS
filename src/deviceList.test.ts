import { describe, expect, it } from 'vitest';
import { mergeDevices, parseIdeviceIds, parseXctraceDevices } from './deviceList';

describe('parseXctraceDevices', () => {
  it('parses real and simulator entries and drops non-iOS lines', () => {
    const input = `
== Devices ==
Johns iPhone (00008030-001C19563E3A802E) (iOS 17.0.3)
iPhone 14 (637A3A45-2C39-4C4D-80BB-7FD24E52CB7A) (iOS 17.2) (Simulator)
Apple TV (1234) (tvOS 17.0) (Simulator)
`;
    const parsed = parseXctraceDevices(input);
    expect(parsed).toHaveLength(2);
    const real = parsed.find((d) => d.kind === 'real');
    const sim = parsed.find((d) => d.kind === 'simulator');
    expect(real?.id).toBe('00008030-001C19563E3A802E');
    expect(real?.osVersion).toBe('17.0.3');
    expect(sim?.name).toBe('iPhone 14');
  });
});

describe('parseIdeviceIds', () => {
  it('parses UDID list', () => {
    const parsed = parseIdeviceIds('00008030-001C19563E3A802E\n00008020-001D26C42212003A\n');
    expect(parsed).toHaveLength(2);
    expect(parsed[0].platform).toBe('ios');
  });
});

describe('mergeDevices', () => {
  it('keeps richer primary data and merges fallback entries', () => {
    const merged = mergeDevices(
      [
        { id: 'A', name: 'Primary', osVersion: '17.2', platform: 'ios', kind: 'real' },
        { id: 'B', name: 'OnlyPrimary', platform: 'ios', kind: 'simulator' }
      ],
      [
        { id: 'A', name: 'Fallback', platform: 'ios', kind: 'real' },
        { id: 'C', name: 'OnlyFallback', platform: 'ios', kind: 'real' }
      ]
    );
    expect(merged.find((d) => d.id === 'A')?.name).toBe('Primary');
    expect(merged.find((d) => d.id === 'C')).toBeTruthy();
    expect(merged).toHaveLength(3);
  });
});
