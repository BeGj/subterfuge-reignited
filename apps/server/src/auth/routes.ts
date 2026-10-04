import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type AuthCredentials,
  type PublicUser,
} from '@subterfuge/engine';
import type { Sql } from '../db.ts';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.ts';
import { RateLimiter } from './rate-limit.ts';
import { SESSION_COOKIE, createSession, deleteSession, findSessionUser } from './sessions.ts';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** JSON schema shared by register and login; Fastify validates the body. */
const credentialsSchema = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    additionalProperties: false,
    properties: {
      // Same rule as USERNAME_PATTERN in @subterfuge/engine and the DB check.
      username: { type: 'string', pattern: '^[A-Za-z0-9_-]{3,20}$' },
      password: { type: 'string', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH },
    },
  },
} as const;

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireUser`. */
    user: PublicUser | null;
  }
}

export interface AuthOptions {
  sql: Sql;
  cookieSecure: boolean;
}

export async function authRoutes(app: FastifyInstance, { sql, cookieSecure }: AuthOptions): Promise<void> {
  const loginPerAccount = new RateLimiter(10, FIFTEEN_MINUTES);
  const loginPerIp = new RateLimiter(50, FIFTEEN_MINUTES);
  const registerPerIp = new RateLimiter(10, HOUR);

  const setSessionCookie = (reply: FastifyReply, token: string, expires: Date) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      expires,
    });

  const startSession = async (reply: FastifyReply, user: PublicUser) => {
    const { token, expiresAt } = await createSession(sql, user.id);
    setSessionCookie(reply, token, expiresAt);
    return user;
  };

  app.post<{ Body: AuthCredentials }>('/api/auth/register', { schema: credentialsSchema }, async (req, reply) => {
    if (!registerPerIp.attempt(req.ip)) {
      return reply.code(429).send({ error: 'Too many sign-ups. Try again later.' });
    }
    const { username, password } = req.body;
    try {
      const [user] = await sql<PublicUser[]>`
        INSERT INTO users (username, password_hash)
        VALUES (${username}, ${await hashPassword(password)})
        RETURNING id, username`;
      reply.code(201);
      return startSession(reply, user!);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'That username is taken.' });
      }
      throw err;
    }
  });

  app.post<{ Body: AuthCredentials }>('/api/auth/login', { schema: credentialsSchema }, async (req, reply) => {
    const { username, password } = req.body;
    const accountKey = `${req.ip}:${username.toLowerCase()}`;
    if (!loginPerIp.attempt(req.ip) || !loginPerAccount.attempt(accountKey)) {
      return reply.code(429).send({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }
    const [row] = await sql<(PublicUser & { passwordHash: string })[]>`
      SELECT id, username, password_hash FROM users WHERE lower(username) = lower(${username})`;
    // Always run scrypt so timing doesn't reveal whether the username exists.
    const ok = await verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);
    if (!row || !ok) {
      return reply.code(401).send({ error: 'Wrong username or password.' });
    }
    loginPerAccount.reset(accountKey);
    return startSession(reply, { id: row.id, username: row.username });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await deleteSession(sql, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireUser(sql) }, async (req) => req.user);
}

/** preHandler that loads the session user, or replies 401. */
export function requireUser(sql: Sql) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    req.user = await findSessionUser(sql, req.cookies[SESSION_COOKIE]);
    if (!req.user) return reply.code(401).send({ error: 'Not logged in.' });
  };
}
