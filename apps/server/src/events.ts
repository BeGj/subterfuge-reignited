import { EventEmitter } from 'node:events';

/**
 * In-process event bus. HTTP routes and the game runtime emit domain events
 * here; `realtime.ts` turns them into Socket.IO messages. Keeps routes free
 * of any knowledge about sockets.
 */
export interface ServerEvents {
  lobbyChanged: [];
  gameStarted: [gameId: string];
}

export type EventBus = EventEmitter<ServerEvents>;

export function createEventBus(): EventBus {
  return new EventEmitter<ServerEvents>();
}
