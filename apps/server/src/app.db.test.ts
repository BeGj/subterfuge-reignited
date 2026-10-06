import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createEventBus } from './events.ts';
import { createTestDb, dbAvailable, type TestDb } from './test/test-db.ts';

describe.skipIf(!dbAvailable)('HTTP app (Postgres)', () => {
  let db: TestDb;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = await createTestDb();
    const config = { ...loadConfig({}), clientDist: '/nonexistent', registrationCode: 'blue-whale' };
    app = await buildApp(config, db.sql, createEventBus());
    app.log.level = 'silent';
  });

  afterAll(async () => {
    await app?.close();
    await db?.cleanup();
  });

  const register = (body: object) => app.inject({ method: 'POST', url: '/api/auth/register', payload: body });

  it('tells the client an invite code is needed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/registration' });
    expect(res.json()).toEqual({ inviteRequired: true });
  });

  it('refuses sign-up without the right invite code', async () => {
    expect((await register({ username: 'nocode', password: 'password123' })).statusCode).toBe(403);
    expect((await register({ username: 'badcode', password: 'password123', inviteCode: 'x' })).statusCode).toBe(403);
  });

  it('accepts sign-up with the invite code', async () => {
    const res = await register({ username: 'invited', password: 'password123', inviteCode: 'blue-whale' });
    expect(res.statusCode).toBe(201);
  });

  it('sends security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
