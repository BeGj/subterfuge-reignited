import { buildApp } from './app.ts';
import { deleteExpiredSessions } from './auth/sessions.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db.ts';
import { migrate } from './migrate.ts';
import { createRealtime } from './realtime.ts';

const config = loadConfig();
const sql = createDb(config.databaseUrl);

// Bring the schema up to date before accepting traffic.
await migrate(sql);

const app = await buildApp(config, sql);
const io = createRealtime(app.server, sql);

const cleanup = setInterval(() => {
  deleteExpiredSessions(sql).catch((err: unknown) => app.log.error(err, 'session cleanup failed'));
}, 60 * 60 * 1000);
cleanup.unref();

await app.listen({ host: config.host, port: config.port });

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} received, shutting down`);
  clearInterval(cleanup);
  await io.close();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
