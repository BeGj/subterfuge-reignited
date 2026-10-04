import { Service, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  GameSnapshot,
  IssueOrderRequest,
  PendingOrder,
  ServerToClientEvents,
} from '@subterfuge/engine';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * The Socket.IO connection to the game server. It runs on the same origin as
 * the page, so the browser sends the session cookie automatically and the
 * server authenticates the socket from it.
 */
@Service()
export class Realtime {
  private socket: GameSocket | undefined;
  private readonly lobbyListeners = new Set<() => void>();
  private readonly gameListeners = new Map<string, Set<(snapshot: GameSnapshot) => void>>();

  private readonly statusSignal = signal<ConnectionStatus>('disconnected');
  private readonly updateSignal = signal(false);

  /**
   * The server serves a newer client than this page runs (the game was
   * updated while you were playing). The app shows a refresh prompt.
   */
  readonly updateAvailable = this.updateSignal.asReadonly();
  private readonly serverTimeSignal = signal<string | undefined>(undefined);

  readonly status = this.statusSignal.asReadonly();
  /** Server clock from the last hello/ping; useful to check the link is live. */
  readonly serverTime = this.serverTimeSignal.asReadonly();

  connect(): void {
    if (this.socket) return;
    this.statusSignal.set('connecting');
    const socket: GameSocket = io({ withCredentials: true });
    socket.on('connect', () => {
      this.statusSignal.set('connected');
      // Rooms are per connection: re-subscribe to watched games after a reconnect.
      for (const gameId of this.gameListeners.keys()) this.rewatch(gameId);
    });
    socket.on('disconnect', () => this.statusSignal.set('connecting'));
    socket.on('connect_error', () => this.statusSignal.set('connecting'));
    socket.on('hello', ({ serverTime, clientBuild }) => {
      this.serverTimeSignal.set(serverTime);
      if (isOutdated(runningBuild(), clientBuild)) this.updateSignal.set(true);
    });
    socket.on('lobbyChanged', () => this.lobbyListeners.forEach((fn) => fn()));
    socket.on('gameUpdate', (snapshot) => this.gameListeners.get(snapshot.gameId)?.forEach((fn) => fn(snapshot)));
    this.socket = socket;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = undefined;
    this.statusSignal.set('disconnected');
  }

  ping(): void {
    this.socket?.emit('ping', (serverTime) => this.serverTimeSignal.set(serverTime));
  }

  /** Calls `fn` whenever the lobby changes. Returns an unsubscribe function. */
  onLobbyChanged(fn: () => void): () => void {
    this.lobbyListeners.add(fn);
    return () => this.lobbyListeners.delete(fn);
  }

  /**
   * Subscribes to a game. `fn` gets the first snapshot and every update.
   * Returns an unsubscribe function. Rejects if the server refuses.
   */
  async watchGame(gameId: string, fn: (snapshot: GameSnapshot) => void): Promise<() => void> {
    this.connect();
    let listeners = this.gameListeners.get(gameId);
    if (!listeners) this.gameListeners.set(gameId, (listeners = new Set()));
    listeners.add(fn);
    const unsubscribe = () => {
      listeners.delete(fn);
      if (listeners.size === 0) {
        this.gameListeners.delete(gameId);
        this.socket?.emit('unwatchGame', gameId);
      }
    };
    try {
      fn(await this.request<{ snapshot: GameSnapshot }>((ack) => this.socket!.emit('watchGame', gameId, ack)).then((r) => r.snapshot));
    } catch (err) {
      unsubscribe();
      throw err;
    }
    return unsubscribe;
  }

  async issueOrder(request: IssueOrderRequest): Promise<PendingOrder> {
    const result = await this.request<{ pending: PendingOrder }>((ack) => this.socket!.emit('issueOrder', request, ack));
    return result.pending;
  }

  async cancelOrder(gameId: string, orderId: string): Promise<void> {
    await this.request<object>((ack) => this.socket!.emit('cancelOrder', { gameId, orderId }, ack));
  }

  private rewatch(gameId: string): void {
    this.socket?.emit('watchGame', gameId, (result) => {
      if (result.ok) this.gameListeners.get(gameId)?.forEach((fn) => fn(result.snapshot));
    });
  }

  /** Wraps an emit-with-ack in a promise that rejects with the server's message. */
  private request<T extends object>(
    send: (ack: (result: ({ ok: true } & T) | { ok: false; error: string }) => void) => void,
  ): Promise<T> {
    if (!this.socket) return Promise.reject(new Error('Not connected.'));
    return new Promise((resolve, reject) => {
      send((result) => (result.ok ? resolve(result) : reject(new Error(result.error))));
    });
  }
}

/** This page's build id: the hash in its main bundle's file name. `null` in development. */
export function runningBuild(doc: Document = document): string | null {
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const match = /main-([A-Z0-9]+)\.js/.exec(script.getAttribute('src') ?? '');
    if (match) return match[1]!;
  }
  return null;
}

/** True when both builds are known and differ. */
export function isOutdated(running: string | null, served: string | null | undefined): boolean {
  return !!running && !!served && running !== served;
}
