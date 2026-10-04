import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('does not trust X-Forwarded-For by default', () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
  });

  it('parses TRUST_PROXY as boolean or proxy list', () => {
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: '10.0.0.1,10.0.0.2' }).trustProxy).toBe('10.0.0.1,10.0.0.2');
  });
});

describe('clientBuildId', () => {
  it('reads the hash from the main bundle in index.html', async () => {
    const { clientBuildId } = await import('./realtime.ts');
    expect(clientBuildId('<script src="main-L3X4QR55.js" type="module"></script>')).toBe('L3X4QR55');
    expect(clientBuildId('<script src="main.js"></script>')).toBeNull();
    expect(clientBuildId(null)).toBeNull();
  });
});
