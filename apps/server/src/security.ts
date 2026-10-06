import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Content Security Policy for the Angular client. Everything is served from
 * this origin. Angular injects component styles as `<style>` tags at runtime,
 * so styles need 'unsafe-inline'; scripts don't (critical-CSS inlining, which
 * adds an inline script, is turned off in angular.json for this reason).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Headers sent with every response. HSTS only when served over HTTPS. */
export function securityHeaders(https: boolean): Record<string, string> {
  return {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    ...(https ? { 'strict-transport-security': 'max-age=31536000' } : {}),
  };
}

/**
 * True when a browser request comes from this site. Socket.IO isn't covered
 * by CORS, so without this any page could open a socket with the visitor's
 * cookie (cross-site WebSocket hijacking). Requests without an Origin header
 * (non-browser clients) can't carry a victim's cookie, so they're allowed.
 */
export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Constant-time comparison of a submitted invite code with the configured one. */
export function inviteCodeMatches(submitted: string | undefined, expected: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(submitted ?? ''), digest(expected));
}
