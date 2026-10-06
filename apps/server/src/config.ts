import { fileURLToPath } from 'node:url';

/** Runtime configuration, read once from environment variables. */
export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  /** Adds the `Secure` flag to the session cookie; enable behind HTTPS. */
  cookieSecure: boolean;
  /** Built Angular app to serve. Skipped if the folder doesn't exist (dev). */
  clientDist: string;
  /**
   * Trust `X-Forwarded-For` for the client IP (used by rate limiting). Only
   * enable behind a reverse proxy you control; otherwise clients can spoof
   * their IP. `true` (trust any proxy) or a comma-separated list of proxy IPs.
   */
  trustProxy: boolean | string;
  /** When set, registering requires this invite code. Unset means open sign-up. */
  registrationCode: string | null;
}

function parseTrustProxy(value: string | undefined): boolean | string {
  if (!value || value === 'false') return false;
  return value === 'true' ? true : value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env['DATABASE_URL'] ?? 'postgres://subterfuge:subterfuge@localhost:5432/subterfuge',
    host: env['HOST'] ?? '127.0.0.1',
    port: Number(env['PORT'] ?? 3000),
    cookieSecure: env['COOKIE_SECURE'] === 'true',
    clientDist:
      env['CLIENT_DIST'] ?? fileURLToPath(new URL('../../client/dist/client/browser', import.meta.url)),
    trustProxy: parseTrustProxy(env['TRUST_PROXY']),
    registrationCode: env['REGISTRATION_CODE'] || null,
  };
}
