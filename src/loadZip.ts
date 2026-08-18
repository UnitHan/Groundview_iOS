import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

export type BundleFiles = {
  screenshotPath: string;
  xmlPath: string;
  deviceId: string;
};

/**
 * Given a directory extracted from a capture .zip (as produced by /api/save-zip),
 * resolve the screenshot + XML paths and the device id.
 *
 * Preference order:
 *  1. meta.json ({ screenshot, xml, deviceId }) written by createCaptureBundle*
 *  2. fall back to scanning the directory (first .png and first .xml)
 *
 * Also tolerant of the Android bundle layout (metadata.json + ui_hierarchy.xml
 * + screenshot.png) so cross-imported dumps still load. Throws if either the
 * screenshot or the XML cannot be located.
 */
export function resolveBundleFiles(dir: string): BundleFiles {
  const entries = safeReaddir(dir);

  let screenshot = '';
  let xml = '';
  let deviceId = 'imported';

  // 1) meta.json (iOS) or metadata.json (Android)
  const metaName = entries.find((f) => f === 'meta.json') || entries.find((f) => f === 'metadata.json');
  if (metaName) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, metaName), 'utf8'));
      if (typeof meta.deviceId === 'string' && meta.deviceId) deviceId = meta.deviceId;
      if (typeof meta.screenshot === 'string' && entries.includes(meta.screenshot)) screenshot = meta.screenshot;
      if (typeof meta.xml === 'string' && entries.includes(meta.xml)) xml = meta.xml;
    } catch {
      // ignore malformed meta
    }
  }

  // 2) fall back to scanning
  if (!screenshot) {
    screenshot =
      entries.find((f) => /\.(png|jpg|jpeg)$/i.test(f)) || '';
  }
  if (!xml) {
    xml = entries.find((f) => /\.xml$/i.test(f)) || '';
  }

  if (!screenshot) throw new Error('screenshot not found in bundle');
  if (!xml) throw new Error('XML source not found in bundle');

  return {
    screenshotPath: path.join(dir, screenshot),
    xmlPath: path.join(dir, xml),
    deviceId,
  };
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Decode a base64-encoded .zip, extract it into a fresh temp directory using the
 * system `unzip`, and return that directory. Caller is responsible for cleanup.
 */
export function extractZipBase64(zipBase64: string): string {
  const buf = Buffer.from(zipBase64, 'base64');
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'groundview-ios-import-'));
  const zipPath = path.join(workRoot, 'import.zip');
  const outDir = path.join(workRoot, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(zipPath, buf);
  const unzipBin = process.platform === 'win32' ? 'unzip' : '/usr/bin/unzip';
  execFileSync(unzipBin, ['-o', zipPath, '-d', outDir], { windowsHide: true });
  return outDir;
}
