import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Sql } from './db.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Arbitrary constant so concurrent server starts don't migrate twice. */
const MIGRATION_LOCK_ID = 7_201_501;

/**
 * Applies every `migrations/NNN_name.sql` file not yet recorded in
 * `schema_migrations`, in filename order, each in its own transaction.
 * Migrations are append-only: never edit one that has been applied — add a
 * new file instead.
 */
export async function migrate(sql: Sql, log: (msg: string) => void = console.log): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  // Advisory locks belong to a connection, so hold one connection throughout.
  const conn = await sql.reserve();
  try {
    await conn`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    await conn`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;
    const applied = new Set(
      (await conn<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name),
    );

    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(MIGRATIONS_DIR + file, 'utf8');
      await conn.unsafe('BEGIN');
      try {
        await conn.unsafe(body);
        await conn`INSERT INTO schema_migrations (name) VALUES (${file})`;
        await conn.unsafe('COMMIT');
      } catch (err) {
        await conn.unsafe('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      log(`Applied migration ${file}`);
      ran.push(file);
    }
    return ran;
  } finally {
    await conn`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(() => {});
    conn.release();
  }
}
