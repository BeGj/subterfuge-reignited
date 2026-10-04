import type { Server as HttpServer } from 'node:http';
import { fastifyCookie } from '@fastify/cookie';
import { Server } from 'socket.io';
import type { ClientToServerEvents, PublicUser, ServerToClientEvents } from '@subterfuge/engine';
import type { Sql } from './db.ts';
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
export function createRealtime(httpServer: HttpServer, sql: Sql): RealtimeServer {
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
    socket.emit('hello', { user, serverTime: new Date().toISOString() });
    socket.on('ping', (ack) => ack(new Date().toISOString()));
  });

  return io;
}
