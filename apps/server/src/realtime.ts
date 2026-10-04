import type { Server as HttpServer } from 'node:http';
import { fastifyCookie } from '@fastify/cookie';
import { Server } from 'socket.io';
import type { ClientToServerEvents, PublicUser, ServerToClientEvents } from '@subterfuge/engine';
import type { Sql } from './db.ts';
import type { EventBus } from './events.ts';
import { SESSION_COOKIE, findSessionUser } from './auth/sessions.ts';

interface SocketData {
  user: PublicUser;
}

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/**
 * Socket.IO runs on the same HTTP server and origin as the API, so the
 * browser sends the session cookie with the handshake and we reuse the
 * normal session lookup. Unauthenticated sockets are rejected.
 */
export function createRealtime(
  httpServer: HttpServer,
  sql: Sql,
  events: EventBus,
  clientBuild: string | null = null,
): RealtimeServer {
  const io: RealtimeServer = new Server(httpServer, { serveClient: false });

  io.use(async (socket, next) => {
    const cookies = fastifyCookie.parse(socket.request.headers.cookie ?? '');
    const user = await findSessionUser(sql, cookies[SESSION_COOKIE]).catch(() => null);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    // One room per user, so every tab/device of a player gets their updates.
    void socket.join(`user:${user.id}`);
    socket.emit('hello', { user, serverTime: new Date().toISOString(), clientBuild });
    socket.on('ping', (ack) => ack(new Date().toISOString()));
  });

  // Lobby changes are public (anyone can browse games), so tell everyone.
  events.on('lobbyChanged', () => io.emit('lobbyChanged'));

  return io;
}

/**
 * Identifies the built client being served: the content hash in the main
 * bundle's file name (`main-ABC123.js` in index.html). It changes whenever
 * the client changes. `null` when there's no build (development).
 */
export function clientBuildId(indexHtml: string | null): string | null {
  return indexHtml?.match(/main-([A-Z0-9]+)\.js/)?.[1] ?? null;
}
