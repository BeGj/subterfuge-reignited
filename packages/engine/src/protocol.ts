/**
 * Shapes shared by the HTTP API and the Socket.IO connection. Living next to
 * the engine means the server and the Angular client can't drift apart.
 */

export interface PublicUser {
  id: string;
  username: string;
}

export interface AuthCredentials {
  username: string;
  password: string;
}

export interface ApiError {
  error: string;
}

/** Events the server sends to the client over Socket.IO. */
export interface ServerToClientEvents {
  hello: (payload: { user: PublicUser; serverTime: string }) => void;
}

/** Events the client sends to the server over Socket.IO. */
export interface ClientToServerEvents {
  ping: (ack: (serverTime: string) => void) => void;
}

/** Validation rules, shared so the client can validate before submitting. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
