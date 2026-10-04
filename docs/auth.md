# Authentication

Simple username + password accounts, built with Node's `crypto` module and Postgres. There's no auth provider and no email. Code: `apps/server/src/auth/`.

## Data

`apps/server/migrations/001_auth.sql`:

- **`users`:** `id` (uuid), `username`, `password_hash`, `created_at`.
  - Usernames are 3–20 characters from `[A-Za-z0-9_-]`.
  - They are unique regardless of case: "Alice" and "alice" can't both exist. They are stored as typed.
- **`sessions`:** `token_hash` (SHA-256 of the cookie token), `user_id`, `expires_at`.

## Passwords (`password.ts`)

- Hashing uses **scrypt** (N=2¹⁵, r=8, p=1, 64-byte key) with a random 16-byte salt per password.
- The stored format is `scrypt$N$r$p$salt$hash`. Because the parameters are stored with each hash, they can be raised later without breaking existing accounts.
- Hashes are compared with `crypto.timingSafeEqual`.
- When a username doesn't exist, login still checks the password against a dummy hash. That way response timing doesn't reveal which usernames are registered.
- Password length: 8–200 characters.

## Sessions (`sessions.ts`)

- On login or registration, the server generates a **random 256-bit token**. The browser gets it in a cookie; the database stores only its SHA-256 hash. A leaked database therefore can't be used to log in.
- Cookie: `sid`, `HttpOnly`, `SameSite=Lax`, `Path=/`, expires after **30 days**. It is `Secure` when `COOKIE_SECURE=true`, which should be set in production behind HTTPS.
- Expired sessions are ignored when looked up, and an hourly job deletes them.
- Logging out deletes the session row and clears the cookie.

## API

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `POST /api/auth/register` | `{ username, password }` | `201` user + cookie | `400` invalid, `409` username taken, `429` |
| `POST /api/auth/login` | `{ username, password }` | `200` user + cookie | `400` invalid, `401` wrong credentials, `429` |
| `POST /api/auth/logout` | – | `204` | – |
| `GET /api/auth/me` | – | `200` user | `401` |

A "user" is `{ id, username }` (`PublicUser` in `packages/engine/src/protocol.ts`).

Protect other routes with the `requireUser(sql)` preHandler from `auth/routes.ts`. It sets `req.user` or replies `401`.

## Rate limiting (`rate-limit.ts`)

This is an in-memory, fixed-window limiter for a single server process:

- Login: 10 attempts per IP+username, and 50 per IP, per 15 minutes. A successful login resets the IP+username counter.
- Registration: 10 per IP per hour.

The limits key on the client IP:
- By default the server uses the TCP peer address and **ignores `X-Forwarded-For`**, which clients can forge.
- Behind your own reverse proxy (nginx, Caddy, a load balancer), set `TRUST_PROXY` (`true`, or better, the proxy's IP) so the real client IP is used.
- Under Docker Desktop, every client appears as the Docker gateway IP and shares one per-IP bucket. That's fine locally.

If we ever run several server instances, move these counters into Postgres.

## Socket.IO

The client connects on the same origin, so the browser sends the `sid` cookie with the handshake. `realtime.ts` looks up the session in middleware and rejects the connection with `unauthorized` if there is none. The user is stored in `socket.data.user`.

## CSRF

- `SameSite=Lax` stops other sites from sending the cookie with background `POST`s.
- Fastify only accepts `application/json` bodies. A plain HTML form posted from another site is rejected with `415`.

## Not implemented (on purpose, for now)

- **Password reset.** We have no email. An admin can reset a password by writing a new hash with `hashPassword()`.
- **SSO, social login, MFA.** Keycloak was considered and rejected as too heavy for this project; see [decisions.md](decisions.md).
