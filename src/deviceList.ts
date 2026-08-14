import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { DeviceRecord, ConnectionType } from './types';

// Get bundled binary path
function getBundledBinaryPath(name: string): string {
  try {
    const bundledPath = path.join(__dirname, '..', '..', 'resources', 'bin', name);
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
    return name;
  } catch (e) {
    return name;
  }
}

function getBundledLibPath(): string | null {
  try {
    const libPath = path.join(__dirname, '..', '..', 'resources', 'lib');
    if (fs.existsSync(libPath)) {
      return libPath;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function run(cmd: string, args: string[], timeoutMs = 6000): Promise<string> {
  return new Promise((resolve, reject) => {
    // Set up environment with bundled libraries
    const env = { ...process.env };
    const libPath = getBundledLibPath();
    if (libPath) {
      env.DYLD_LIBRARY_PATH = libPath + ':' + (env.DYLD_LIBRARY_PATH || '');
    }
    
    const ps = execFile(
      cmd,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env
      },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      }
    );
    ps.on('error', (e) => reject(e));
  });
}

// Handles both xctrace formats:
//   old: "Johns iPhone (00008030-001C19563E3A802E) (iOS 17.0.3)"
//   new: "Nerget QA (17.6.1) (00008110-001679810281401E)"   (real, wireless or USB)
// Sections "== Devices ==" / "== Simulators ==" are tracked; the host Mac line
// (no version group) and non-iOS devices (tvOS/watchOS) are dropped.
export function parseXctraceDevices(raw: string): DeviceRecord[] {
  if (!raw) return [];
  const UDID_RE = /^[0-9a-f]{40}$|^[0-9A-F]{8}-[0-9A-F]{16}$|^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i;
  const devices: DeviceRecord[] = [];
  let section = '';
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const hdr = line.match(/^==\s*(.+?)\s*==$/);
    if (hdr) { section = hdr[1].toLowerCase(); continue; }

    const groups = [...line.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
    if (!groups.length) continue;

    const udid = groups.find((g) => UDID_RE.test(g));
    if (!udid) continue; // no device UDID (e.g. host Mac shows only a UUID handled below)

    // Find an OS/version group; reject non-iOS platforms.
    let osVersion: string | undefined;
    let nonIos = false;
    for (const g of groups) {
      if (g === udid) continue;
      const m = g.match(/^(iOS|iPadOS|tvOS|watchOS|macOS|xrOS)?\s*(\d+(?:\.\d+)*)$/i);
      if (m) {
        const osName = (m[1] || '').toLowerCase();
        if (osName && osName !== 'ios' && osName !== 'ipados') { nonIos = true; break; }
        osVersion = m[2];
        break;
      }
    }
    if (nonIos) continue;
    if (!osVersion) continue; // host Mac has a UUID but no version → skip

    const isSim =
      section.startsWith('simulator') ||
      /\(simulator\)/i.test(line) ||
      groups.some((g) => /^simulator$/i.test(g));
    const name = (line.includes('(') ? line.slice(0, line.indexOf('(')) : line).trim();

    devices.push({
      id: udid,
      name: name || 'iOS Device',
      osVersion,
      kind: isSim ? 'simulator' : 'real',
      platform: 'ios'
    });
  }
  return devices;
}

export function parseIdeviceIds(raw: string): DeviceRecord[] {
  if (!raw) return [];
  const ids = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 6);
  return ids.map((id) => ({
    id,
    name: 'iOS Device',
    platform: 'ios',
    kind: 'real'
  }));
}

export function mergeDevices(primary: DeviceRecord[], fallback: DeviceRecord[]): DeviceRecord[] {
  const map = new Map<string, DeviceRecord>();
  const push = (d: DeviceRecord) => {
    const existing = map.get(d.id);
    if (!existing) {
      map.set(d.id, d);
      return;
    }
    map.set(d.id, {
      ...existing,
      name: existing.name || d.name,
      osVersion: existing.osVersion || d.osVersion,
      kind: existing.kind || d.kind,
      connectionType: existing.connectionType || d.connectionType,
      ipAddress: existing.ipAddress || d.ipAddress
    });
  };
  primary.forEach(push);
  fallback.forEach(push);
  return Array.from(map.values()).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export async function listDevices(): Promise<DeviceRecord[]> {
  if (process.platform !== 'darwin') return [];
  
  // Use bundled idevice_id binary
  const ideviceIdPath = getBundledBinaryPath('idevice_id');
  
  const [xcrunOut, ideviceOut] = await Promise.allSettled([
    run('xcrun', ['xctrace', 'list', 'devices']),
    run(ideviceIdPath, ['-l']).catch(() => '')
  ]);
  // Real devices only — simulators can't be driven over WDA/iproxy/tunnel here.
  const primary = (xcrunOut.status === 'fulfilled' ? parseXctraceDevices(xcrunOut.value) : [])
    .filter((d) => d.kind === 'real');
  const fallback = ideviceOut.status === 'fulfilled' ? parseIdeviceIds(ideviceOut.value) : [];
  
  // idevice_id only detects USB devices
  for (const d of fallback) {
    d.connectionType = 'usb';
  }
  
  // Determine connection type for xctrace devices:
  // If a device is in idevice_id output, it's USB. Otherwise it's likely WiFi.
  const usbIds = new Set(fallback.map(d => d.id));
  for (const d of primary) {
    if (usbIds.has(d.id)) {
      d.connectionType = 'usb';
    } else if (d.kind === 'real') {
      d.connectionType = 'wifi';
    }
  }
  
  // Also add manually registered WiFi devices
  const manual = getManualWifiDevices();
  
  return mergeDevices(mergeDevices(primary, fallback), manual);
}

// --- Manual WiFi device registry ---
const manualWifiDevices = new Map<string, DeviceRecord>();

export function addManualWifiDevice(ip: string, name?: string, port = 8100): DeviceRecord {
  const id = `wifi-${ip}`;
  const device: DeviceRecord = {
    id,
    name: name || `WiFi Device (${ip})`,
    platform: 'ios',
    kind: 'real',
    connectionType: 'wifi',
    ipAddress: ip
  };
  manualWifiDevices.set(id, device);
  return device;
}

export function removeManualWifiDevice(ip: string): boolean {
  return manualWifiDevices.delete(`wifi-${ip}`);
}

export function getManualWifiDevices(): DeviceRecord[] {
  return Array.from(manualWifiDevices.values());
}

export function isMac(): boolean {
  return os.platform() === 'darwin';
}
