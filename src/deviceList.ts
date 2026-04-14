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

export function parseXctraceDevices(raw: string): DeviceRecord[] {
  if (!raw) return [];
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('==') && !l.toLowerCase().startsWith('legacy'));
  const devices: DeviceRecord[] = [];
  for (const line of lines) {
    if (!/iOS/i.test(line)) continue;
    const parenParts = [...line.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
    if (parenParts.length === 0) continue;
    const osPart = parenParts.find((p) => /^iOS\s/i.test(p));
    if (!osPart) continue;
    const udidPart = parenParts.find((p) => /^[0-9a-fA-F-]{6,}$/i.test(p));
    const name = line.split('(')[0].trim();
    const isSim = /Simulator/i.test(line);
    devices.push({
      id: udidPart || `${name}-${osPart}`,
      name,
      osVersion: osPart.replace(/^iOS\s*/i, ''),
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
  const primary = xcrunOut.status === 'fulfilled' ? parseXctraceDevices(xcrunOut.value) : [];
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
