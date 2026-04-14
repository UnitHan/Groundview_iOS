import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SERVICE = 'GroundView iOS';
const GEMINI_ACCOUNT = 'GEMINI_API_KEY';

export type SettingsData = {
  geminiModel?: string;
  geminiKeyHash?: string;
  geminiKeySalt?: string;
};

function settingsDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', SERVICE);
  }
  return path.join(os.homedir(), '.groundview-ios');
}

function settingsPath(): string {
  return path.join(settingsDir(), 'settings.json');
}

export function loadSettings(): SettingsData {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as SettingsData;
    return parsed || {};
  } catch {
    return {};
  }
}

export function saveSettings(partial: SettingsData): SettingsData {
  const current = loadSettings();
  const next: SettingsData = {
    ...current,
    ...partial
  };
  try {
    fs.mkdirSync(settingsDir(), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // ignore write errors
  }
  return next;
}

export function hashSecret(secret: string, salt?: string): { hash: string; salt: string } {
  const usedSalt = salt || crypto.randomBytes(16).toString('base64');
  const derived = crypto.scryptSync(secret, usedSalt, 32);
  return { hash: derived.toString('base64'), salt: usedSalt };
}

async function runSecurity(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('security', args);
  return (stdout || '').toString().trim();
}

export async function storeGeminiKey(apiKey: string): Promise<{ hash: string; salt: string }> {
  if (process.platform === 'darwin') {
    await runSecurity(['add-generic-password', '-a', GEMINI_ACCOUNT, '-s', SERVICE, '-w', apiKey, '-U']);
  }
  const { hash, salt } = hashSecret(apiKey);
  saveSettings({ geminiKeyHash: hash, geminiKeySalt: salt });
  return { hash, salt };
}

export async function readGeminiKey(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined;
  try {
    const key = await runSecurity(['find-generic-password', '-a', GEMINI_ACCOUNT, '-s', SERVICE, '-w']);
    return key || undefined;
  } catch {
    return undefined;
  }
}

export async function clearGeminiKey(): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      await runSecurity(['delete-generic-password', '-a', GEMINI_ACCOUNT, '-s', SERVICE]);
    } catch {
      // ignore
    }
  }
  saveSettings({ geminiKeyHash: undefined, geminiKeySalt: undefined });
}

export function resolveGeminiModel(): string {
  const settings = loadSettings();
  return settings.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

export function saveGeminiModel(model?: string): void {
  if (!model) return;
  saveSettings({ geminiModel: model });
}
