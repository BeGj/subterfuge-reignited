import { Service, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@subterfuge/engine';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/**
 * The Socket.IO connection to the game server. It runs on the same origin as
 * the page, so the browser sends the session cookie automatically and the
 * server authenticates the socket from it.
 */
@Service()
export class Realtime {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | undefined;

  private readonly statusSignal = signal<ConnectionStatus>('disconnected');
  private readonly serverTimeSignal = signal<string | undefined>(undefined);

  readonly status = this.statusSignal.asReadonly();
  /** Server clock from the last hello/ping; useful to check the link is live. */
  readonly serverTime = this.serverTimeSignal.asReadonly();

  connect(): void {
    if (this.socket) return;
    this.statusSignal.set('connecting');
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ withCredentials: true });
    socket.on('connect', () => this.statusSignal.set('connected'));
    socket.on('disconnect', () => this.statusSignal.set('connecting'));
    socket.on('connect_error', () => this.statusSignal.set('connecting'));
    socket.on('hello', ({ serverTime }) => this.serverTimeSignal.set(serverTime));
    this.socket = socket;
  }

  ping(): void {
    this.socket?.emit('ping', (serverTime) => this.serverTimeSignal.set(serverTime));
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = undefined;
    this.statusSignal.set('disconnected');
  }
}
