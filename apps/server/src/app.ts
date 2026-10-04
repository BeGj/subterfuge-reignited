import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.ts';
import type { Sql } from './db.ts';
import { authRoutes } from './auth/routes.ts';

/** Builds the HTTP app. Kept separate from `main.ts` so tests can use `app.inject()`. */
export async function buildApp(config: Config, sql: Sql): Promise<FastifyInstance> {
  const options: FastifyServerOptions = {
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    // Off by default: X-Forwarded-For is client-controlled unless a trusted proxy sets it.
    trustProxy: config.trustProxy,
  };
  const app = Fastify(options);

  await app.register(fastifyCookie);
  await app.register(authRoutes, { sql, cookieSecure: config.cookieSecure });

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
