import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadWdaConfig } from './config';

describe('loadWdaConfig', () => {
  it('parses numeric env vars and log file', () => {
    const cfg = loadWdaConfig({
      WDA_HOST: '10.0.0.5',
      WDA_PORT: '8200',
      WDA_TIMEOUT_MS: '15000',
      WDA_RETRIES: '2',
      WDA_RETRY_DELAY_MS: '500',
      WDA_LOG_FILE: '/tmp/wda.log'
    } as any);
    expect(cfg.options.host).toBe('10.0.0.5');
    expect(cfg.options.port).toBe(8200);
    expect(cfg.options.timeoutMs).toBe(15000);
    expect(cfg.options.retries).toBe(2);
    expect(cfg.options.retryDelayMs).toBe(500);
    expect(cfg.logFile).toBe('/tmp/wda.log');
  });

  it('ignores invalid numbers', () => {
    const cfg = loadWdaConfig({ WDA_PORT: 'abc' } as any);
    expect(cfg.options.port).toBeUndefined();
  });

  it('merges config file with env overrides', () => {
    const tmp = path.join(__dirname, 'tmp-wda-config.json');
    fs.writeFileSync(
      tmp,
      JSON.stringify({ host: '1.1.1.1', port: 9000, retries: 2, logFile: '/tmp/file.log' }),
      'utf8'
    );
    const cfg = loadWdaConfig({ WDA_CONFIG: tmp, WDA_PORT: '8101' } as any);
    expect(cfg.options.host).toBe('1.1.1.1');
    expect(cfg.options.port).toBe(8101); // env override
    expect(cfg.options.retries).toBe(2);
    expect(cfg.logFile).toBe('/tmp/file.log');
    fs.unlinkSync(tmp);
  });
});
