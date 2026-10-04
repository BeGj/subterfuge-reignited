import { Service, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import { CONNECT_ERRORS } from '@subterfuge/engine';
import type {
  ClientToServerEvents,
  GameSnapshot,
  IssueOrderRequest,
  PendingOrder,
  ServerToClientEvents,
} from '@subterfuge/engine';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/** How long "connecting…" may last before the app offers a reload. */
export const STUCK_AFTER_MS = 15_000;

/** Backoff for retrying refused connections: 1 s, 2 s, 4 s … capped at 10 s. */
export function retryDelay(attempt: number): number {
  return Math.min(10_000, 1000 * 2 ** attempt);
}

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
  private readonly stuckSignal = signal(false);
  private readonly expiredSignal = signal(false);
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;

  /** Still not connected after `STUCK_AFTER_MS`; the app offers a reload. */
  readonly stuck = this.stuckSignal.asReadonly();
  /** The server says the session is no longer valid; the app asks to log in. */
  readonly sessionExpired = this.expiredSignal.asReadonly();

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
    this.setStatus('connecting');
    const socket: GameSocket = io({ withCredentials: true });
    socket.on('connect', () => {
      this.retries = 0;
      this.setStatus('connected');
      // Rooms are per connection: re-subscribe to watched games after a reconnect.
      for (const gameId of this.gameListeners.keys()) this.rewatch(gameId);
    });
    socket.on('disconnect', () => this.setStatus('connecting'));
    socket.on('connect_error', (err) => {
      this.setStatus('connecting');
      // Socket.IO retries network failures by itself (socket.active), but
      // not connections the server refused. Handle those here, or the page
      // would sit on "connecting…" forever.
      if (socket.active) return;
      if (err.message === CONNECT_ERRORS.unauthorized) {
        this.expiredSignal.set(true);
        return;
      }
      this.scheduleRetry();
    });
    socket.on('hello', ({ serverTime, clientBuild }) => {
      this.serverTimeSignal.set(serverTime);
      if (isOutdated(runningBuild(), clientBuild)) this.updateSignal.set(true);
    });
    socket.on('lobbyChanged', () => this.lobbyListeners.forEach((fn) => fn()));
    socket.on('gameUpdate', (snapshot) => this.gameListeners.get(snapshot.gameId)?.forEach((fn) => fn(snapshot)));
    this.socket = socket;
  }

  disconnect(): void {
    clearTimeout(this.retryTimer);
    this.socket?.disconnect();
    this.socket = undefined;
    this.setStatus('disconnected');
  }

  /** Reconnect right away if we're not connected (tab shown again, network back). */
  nudge(): void {
    if (this.socket && !this.socket.connected && !this.expiredSignal()) this.socket.connect();
  }

  private scheduleRetry(): void {
    clearTimeout(this.retryTimer);
    const delay = retryDelay(this.retries++);
    this.retryTimer = setTimeout(() => this.socket?.connect(), delay);
  }

  private setStatus(status: ConnectionStatus): void {
    const previous = this.statusSignal();
    this.statusSignal.set(status);
    if (status === 'connecting') {
      // Start the countdown only when the connection is first lost: every
      // failed retry reports "connecting" again and must not restart it,
      // or the stuck banner would never appear while retries keep failing.
      if (previous !== 'connecting') {
        clearTimeout(this.stuckTimer);
        this.stuckTimer = setTimeout(() => this.stuckSignal.set(true), STUCK_AFTER_MS);
      }
    } else {
      clearTimeout(this.stuckTimer);
      this.stuckSignal.set(false);
    }
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
