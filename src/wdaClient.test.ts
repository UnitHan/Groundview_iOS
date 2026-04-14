import { describe, expect, it } from 'vitest';
import {
  decodeScreenshotPayload,
  decodeSourcePayload,
  extractValuePayload
} from './wdaClient';

const base64Hello = Buffer.from('hello', 'utf8').toString('base64');

describe('decodeScreenshotPayload', () => {
  it('decodes from string and nested value', () => {
    expect(decodeScreenshotPayload(base64Hello).toString('utf8')).toBe('hello');
    expect(
      decodeScreenshotPayload({ value: base64Hello }).toString('utf8')
    ).toBe('hello');
    expect(
      decodeScreenshotPayload({ value: { value: base64Hello } }).toString('utf8')
    ).toBe('hello');
  });
});

describe('decodeSourcePayload', () => {
  it('extracts xml/text from several shapes', () => {
    expect(decodeSourcePayload('<xml/>')).toBe('<xml/>');
    expect(decodeSourcePayload({ value: '<json/>' })).toBe('<json/>');
    expect(decodeSourcePayload({ value: { source: '<node />' } })).toBe('<node />');
  });
});

describe('extractValuePayload', () => {
  it('returns nested value property if present', () => {
    expect(extractValuePayload({ value: 123 })).toBe(123);
    expect(extractValuePayload('abc')).toBe('abc');
  });
});
