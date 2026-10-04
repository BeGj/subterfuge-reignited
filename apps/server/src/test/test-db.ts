import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDb, type Sql } from '../db.ts';
import { migrate } from '../migrate.ts';

/**
 * Throwaway Postgres databases for tests. Each test file gets a fresh,
 * migrated database, dropped afterwards. When Postgres isn't reachable the
 * DB suites are skipped (`describe.skipIf(!dbAvailable)`), so `npm test`
 * still works without Docker.
 */

const ADMIN_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://subterfuge:subterfuge@localhost:5432/subterfuge';

async function probe(): Promise<boolean> {
  const sql = postgres(ADMIN_URL, { connect_timeout: 2, max: 1, onnotice: () => {} });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export const dbAvailable = await probe();
if (!dbAvailable) {
  console.warn(`[test-db] Postgres not reachable at ${ADMIN_URL.replace(/\/\/[^@]*@/, '//***@')}; skipping DB tests.`);
}

export interface TestDb {
  sql: Sql;
  cleanup: () => Promise<void>;
}

/** Creates and migrates a fresh database; `cleanup` drops it. */
export async function createTestDb(): Promise<TestDb> {
  const name = `sub_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${name}"`);

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const sql = createDb(url.toString());
  await migrate(sql, () => {});

  return {
    sql,
    cleanup: async () => {
      await sql.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    },
  };
}

/** Inserts a user directly (no password hashing; tests don't log in). */
export async function createUser(sql: Sql, username: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (username, password_hash) VALUES (${username}, 'test') RETURNING id`;
  return row!.id;
}
