import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveBundleFiles } from './loadZip';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadzip-test-'));
});

afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const write = (name: string, content: string) =>
  fs.writeFileSync(path.join(dir, name), content, 'utf8');

describe('resolveBundleFiles', () => {
  it('resolves from iOS meta.json (screenshot/source.xml + deviceId)', () => {
    write('screenshot.png', 'png');
    write('source.xml', '<XCUIElementTypeApplication/>');
    write('meta.json', JSON.stringify({ deviceId: 'iphone-123', screenshot: 'screenshot.png', xml: 'source.xml' }));

    const r = resolveBundleFiles(dir);
    expect(r.deviceId).toBe('iphone-123');
    expect(r.screenshotPath).toBe(path.join(dir, 'screenshot.png'));
    expect(r.xmlPath).toBe(path.join(dir, 'source.xml'));
  });

  it('resolves from Android-style metadata.json + ui_hierarchy.xml', () => {
    write('screenshot.png', 'png');
    write('ui_hierarchy.xml', '<hierarchy/>');
    write('metadata.json', JSON.stringify({ deviceId: 'android-9', screenshot: 'screenshot.png', xml: 'ui_hierarchy.xml' }));

    const r = resolveBundleFiles(dir);
    expect(r.deviceId).toBe('android-9');
    expect(r.xmlPath).toBe(path.join(dir, 'ui_hierarchy.xml'));
  });

  it('falls back to scanning when no meta is present', () => {
    write('shot.png', 'png');
    write('tree.xml', '<root/>');

    const r = resolveBundleFiles(dir);
    expect(r.deviceId).toBe('imported');
    expect(r.screenshotPath).toBe(path.join(dir, 'shot.png'));
    expect(r.xmlPath).toBe(path.join(dir, 'tree.xml'));
  });

  it('ignores malformed meta.json and still scans', () => {
    write('screenshot.png', 'png');
    write('source.xml', '<x/>');
    write('meta.json', '{ not valid json');

    const r = resolveBundleFiles(dir);
    expect(r.deviceId).toBe('imported');
    expect(r.screenshotPath).toBe(path.join(dir, 'screenshot.png'));
    expect(r.xmlPath).toBe(path.join(dir, 'source.xml'));
  });

  it('throws when the screenshot is missing', () => {
    write('source.xml', '<x/>');
    expect(() => resolveBundleFiles(dir)).toThrow(/screenshot not found/);
  });

  it('throws when the XML is missing', () => {
    write('screenshot.png', 'png');
    expect(() => resolveBundleFiles(dir)).toThrow(/XML source not found/);
  });
});
