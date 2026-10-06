import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { inviteCodeMatches, isSameOrigin, securityHeaders } from './security.ts';

const request = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

describe('isSameOrigin', () => {
  it('allows requests from the page origin', () => {
    expect(isSameOrigin(request({ host: 'game.example', origin: 'https://game.example' }))).toBe(true);
    expect(isSameOrigin(request({ host: 'localhost:4200', origin: 'http://localhost:4200' }))).toBe(true);
  });

  it('rejects other origins, including sibling subdomains', () => {
    expect(isSameOrigin(request({ host: 'game.example', origin: 'https://evil.example' }))).toBe(false);
    expect(isSameOrigin(request({ host: 'game.example', origin: 'https://ha.game.example' }))).toBe(false);
    expect(isSameOrigin(request({ host: 'game.example', origin: 'null' }))).toBe(false);
  });

  it('allows non-browser clients that send no Origin', () => {
    expect(isSameOrigin(request({ host: 'game.example' }))).toBe(true);
  });
});

describe('inviteCodeMatches', () => {
  it('matches only the exact code', () => {
    expect(inviteCodeMatches('blue-whale', 'blue-whale')).toBe(true);
    expect(inviteCodeMatches('blue-whal', 'blue-whale')).toBe(false);
    expect(inviteCodeMatches('', 'blue-whale')).toBe(false);
    expect(inviteCodeMatches(undefined, 'blue-whale')).toBe(false);
  });
});

describe('securityHeaders', () => {
  it('forbids framing and inline scripts', () => {
    const csp = securityHeaders(false)['content-security-policy'];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self';");
  });

  it('sends HSTS only over HTTPS', () => {
    expect(securityHeaders(false)['strict-transport-security']).toBeUndefined();
    expect(securityHeaders(true)['strict-transport-security']).toBeDefined();
  });
});
