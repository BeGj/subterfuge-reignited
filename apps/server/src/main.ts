import { buildApp } from './app.ts';
import { deleteExpiredSessions } from './auth/sessions.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db.ts';
import { createEventBus } from './events.ts';
import { migrate } from './migrate.ts';
import { createRealtime } from './realtime.ts';
import { GameRuntime } from './games/runtime.ts';
import { attachGameHandlers, gameRoom } from './games/socket-handlers.ts';

const config = loadConfig();
const sql = createDb(config.databaseUrl);

// Bring the schema up to date before accepting traffic.
await migrate(sql);

const events = createEventBus();
const app = await buildApp(config, sql, events);
const io = createRealtime(app.server, sql, events);
const runtime = new GameRuntime({
  sql,
  events,
  log: app.log,
  sink: (gameId, playerId, snapshot) => io.to(gameRoom(gameId, playerId)).emit('gameUpdate', snapshot),
});
attachGameHandlers(io, runtime, app.log);
await runtime.start();

const cleanup = setInterval(() => {
  deleteExpiredSessions(sql).catch((err: unknown) => app.log.error(err, 'session cleanup failed'));
}, 60 * 60 * 1000);
cleanup.unref();

await app.listen({ host: config.host, port: config.port });

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} received, shutting down`);
  clearInterval(cleanup);
  runtime.stop();
  await io.close();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
