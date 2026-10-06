import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.ts';
import type { Sql } from './db.ts';
import { authRoutes } from './auth/routes.ts';
import type { EventBus } from './events.ts';
import { lobbyRoutes } from './games/lobby-routes.ts';
import { securityHeaders } from './security.ts';

/** Builds the HTTP app. Kept separate from `main.ts` so tests can use `app.inject()`. */
export async function buildApp(config: Config, sql: Sql, events: EventBus): Promise<FastifyInstance> {
  const options: FastifyServerOptions = {
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    // Off by default: X-Forwarded-For is client-controlled unless a trusted proxy sets it.
    trustProxy: config.trustProxy,
    // Requests are small JSON bodies; the 1 MiB default only helps abusers.
    bodyLimit: 64 * 1024,
  };
  const app = Fastify(options);

  const headers = securityHeaders(config.cookieSecure);
  app.addHook('onSend', async (_req, reply) => {
    reply.headers(headers);
  });

  // Fastify's default handler echoes the error message, which for a 500 can
  // be a database error. Log those and send a generic message instead.
  app.setErrorHandler((err: { statusCode?: number }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status < 500) return reply.send(err);
    req.log.error(err);
    return reply.code(status).send({ error: 'Something went wrong.' });
  });

  await app.register(fastifyCookie);
  // Declared at the root so every route plugin shares it (set by requireUser).
  app.decorateRequest('user', null);
  await app.register(authRoutes, { sql, cookieSecure: config.cookieSecure, registrationCode: config.registrationCode });
  await app.register(lobbyRoutes, { sql, events });

  app.get('/api/health', async () => {
    await sql`SELECT 1`;
    return { ok: true };
  });

  // In production the server also serves the built Angular app. Unknown
  // non-API GETs fall back to index.html so client-side routes work on reload.
  if (existsSync(config.clientDist)) {
    await app.register(fastifyStatic, { root: config.clientDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found.' });
    });
  } else {
    app.log.info(`No client build at ${config.clientDist}; serving API only (use ng serve in dev).`);
  }

  return app;
}
