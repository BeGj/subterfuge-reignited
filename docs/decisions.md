# Decision log

Short records of technical decisions: what we chose, and why. Newest first. Add an entry whenever a choice would surprise a newcomer.

---

### 2026-10-04 — Don't trust X-Forwarded-For by default
**Decision:** Fastify's `trustProxy` comes from the `TRUST_PROXY` env var and defaults to `false`.
**Why:** with it on, any client could send a fake `X-Forwarded-For` and get a fresh rate-limit bucket on every request, which made the login brute-force limits useless. Deployments behind a real proxy opt in.

### 2026-10-04 — UUIDv7 primary keys for users
**Decision:** `users.id` is `uuid DEFAULT uuidv7()`.
**Why:** user IDs are sent to other players, so they shouldn't be guessable or reveal how many accounts exist. UUIDv7 is time-ordered, which keeps B-tree inserts cheap (it needs Postgres 18+). Other tables should prefer `bigint GENERATED ALWAYS AS IDENTITY` unless their IDs are exposed in the same way.

### 2026-10-04 — Engine is compiled; server runs TypeScript directly
**Decision:** `packages/engine` is compiled with `tsc` to `dist/`. `apps/server` runs `.ts` source directly with Node 24's built-in type stripping.
**Why:**
- Angular's build expects compiled packages.
- The server needs no build step, which keeps the Dockerfile and `npm run dev` simple.
**Consequence:** server code must use only erasable TypeScript syntax (no `enum` or parameter properties) and `.ts` import extensions.

### 2026-10-04 — Shared wire types live in the engine package
**Decision:** API and Socket.IO payload types and validation constants are in `packages/engine/src/protocol.ts`.
**Why:** the engine is already shared by server and client, and a separate package for a few types isn't worth it yet. Split it out if it grows.

### 2026-10-04 — Hand-written auth, no Keycloak
**Decision:** username + password with `crypto.scrypt` and Postgres-backed sessions in an httpOnly cookie. Details are in [auth.md](auth.md).
**Why:**
- The project must run with `docker compose up` and no third-party services.
- Keycloak would work self-hosted, but it's a heavy Java service with realm config to maintain and OIDC wiring in both the client and the server. That's more complexity than the rest of the auth combined.
**Revisit if:** we need SSO, social login or MFA.

### 2026-10-04 — No third-party helpers where built-ins suffice
**Decision:** `scripts/dev.mjs` instead of `concurrently`, a ~60-line SQL migration runner instead of a migration tool, a hand-written rate limiter, and a direct `new Server(fastify.server)` instead of the `fastify-socket.io` plugin.
**Why:** fewer dependencies to audit and update; the user explicitly prefers this.

### 2026-10-04 — Tech stack
**Decision:**

| Layer | Choice |
|---|---|
| Language | TypeScript |
| Client | Angular 22 (signals, Signal Forms) |
| Server | Node 24 + Fastify 5 |
| Realtime | Socket.IO 4 |
| Database | Postgres 18 with postgres.js |
| Tests | Vitest |
| Workspaces | npm workspaces |

**Why:** a single language shares the rules engine between server and client, which the time machine needs. The game is slow and event-driven, so a conventional web stack fits; there's no need for game-netcode tooling.

### 2026-10-04 — Shield ratio is a tunable
**Decision:** `STRONG_SHIELD_SHARE = 1/3` in `packages/engine/src/constants.ts`.
**Why:** the official sources disagree (see goal.md → Shields), so we keep our original design and make it easy to change.
