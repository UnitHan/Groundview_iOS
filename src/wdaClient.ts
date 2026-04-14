import fs from 'fs/promises';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import { CaptureResult, HealthStatus, WdaOptions } from './types';

type HttpResult = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY = 200;

function tmpFile(ext: string): string {
  return path.join(
    os.tmpdir(),
    `groundview-ios-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`
  );
}

function buildUrl(opts: WdaOptions, route: string): string {
  const host = opts.host || '127.0.0.1';
  const port = opts.port ?? 8100;
  const normalized = route.startsWith('/') ? route : `/${route}`;
  return `http://${host}:${port}${normalized}`;
}

function httpGet(url: string, timeoutMs: number): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json'
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(typeof d === 'string' ? Buffer.from(d) : d));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

function parseJson(body: Buffer): any {
  const text = body.toString('utf8');
  return JSON.parse(text);
}

export function extractValuePayload(obj: any): any {
  if (obj && typeof obj === 'object' && 'value' in obj) return obj.value;
  return obj;
}

export function decodeScreenshotPayload(value: any): Buffer {
  if (typeof value === 'string') return Buffer.from(value, 'base64');
  if (value && typeof value === 'object') {
    if (typeof value.value === 'string') return Buffer.from(value.value, 'base64');
    if (value.value && typeof value.value === 'object' && typeof value.value.value === 'string') {
      return Buffer.from(value.value.value, 'base64');
    }
    if (typeof value.data === 'string') return Buffer.from(value.data, 'base64');
  }
  throw new Error('screenshot payload missing base64 data');
}

export function decodeSourcePayload(value: any): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    if (typeof value.value === 'string') return value.value;
    if (value.value && typeof value.value === 'object' && typeof value.value.source === 'string') {
      return value.value.source;
    }
    if (typeof value.source === 'string') return value.source;
  }
  throw new Error('source payload missing string data');
}

export class WdaClient {
  private opts: WdaOptions;

  constructor(opts: WdaOptions = {}) {
    this.opts = opts;
  }

  async health(): Promise<HealthStatus> {
    const url = buildUrl(this.opts, '/status');
    try {
      const res = await httpGet(url, this.opts.timeoutMs || DEFAULT_TIMEOUT);
      const payload = extractValuePayload(parseJson(res.body));
      const ok = res.statusCode === 200;
      const state =
        (payload && (payload.state || payload.ready || payload.sessionId || payload.sessionId)) || '';
      const bundle =
        payload && payload.build && payload.build.productBundleIdentifier
          ? payload.build.productBundleIdentifier
          : '';
      const version =
        payload && payload.build && payload.build.productVersion ? payload.build.productVersion : '';
      const detailParts = [`state=${state || 'unknown'}`];
      if (bundle) detailParts.push(`bundle=${bundle}`);
      if (version) detailParts.push(`version=${version}`);
      return { ok, details: detailParts.join(' ') };
    } catch (e) {
      return { ok: false, details: e instanceof Error ? e.message : String(e) };
    }
  }

  async capture(): Promise<CaptureResult> {
    const screenshotPath = tmpFile('png');
    const xmlPath = tmpFile('xml');
    try {
      const [screenshot, source] = await Promise.all([
        this.fetchScreenshot(),
        this.fetchSource()
      ]);
      await fs.writeFile(screenshotPath, screenshot);
      await fs.writeFile(xmlPath, source, 'utf8');
      return { screenshotPath, xmlPath };
    } catch (e) {
      return {
        screenshotPath,
        xmlPath,
        error: e instanceof Error ? e.message : String(e)
      };
    }
  }

  private async fetchScreenshot(): Promise<Buffer> {
    const url = buildUrl(this.opts, '/screenshot');
    const timeout = this.opts.timeoutMs || DEFAULT_TIMEOUT;
    const retries = this.opts.retries ?? DEFAULT_RETRIES;
    const delay = this.opts.retryDelayMs ?? DEFAULT_RETRY_DELAY;
    const res = await retry(() => httpGet(url, timeout), retries, delay);
    if (res.statusCode >= 400) throw new Error(`screenshot failed: http ${res.statusCode}`);
    const contentType = res.headers['content-type'] || '';
    if (/image\//i.test(contentType)) {
      return res.body;
    }
    const payload = extractValuePayload(parseJson(res.body));
    return decodeScreenshotPayload(payload);
  }

  private async fetchSource(): Promise<string> {
    const url = buildUrl(this.opts, '/source');
    const timeout = this.opts.timeoutMs || DEFAULT_TIMEOUT;
    const retries = this.opts.retries ?? DEFAULT_RETRIES;
    const delay = this.opts.retryDelayMs ?? DEFAULT_RETRY_DELAY;
    const res = await retry(() => httpGet(url, timeout), retries, delay);
    if (res.statusCode >= 400) throw new Error(`source failed: http ${res.statusCode}`);
    const contentType = res.headers['content-type'] || '';
    if (/xml/i.test(contentType) || /html/i.test(contentType)) {
      return res.body.toString('utf8');
    }
    const payload = extractValuePayload(parseJson(res.body));
    return decodeSourcePayload(payload);
  }
}

async function retry<T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts) break;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
