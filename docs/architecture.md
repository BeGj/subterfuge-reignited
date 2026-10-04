# Architecture

## Overview

```
 Browser (Angular)                     Server (Node + Fastify)                 Postgres
 ─────────────────                     ───────────────────────                 ────────
  pages, map UI     ── HTTP /api ──▶   auth routes, game API      ── SQL ──▶   users, sessions,
  time machine      ◀─ Socket.IO ──▶   realtime (per-user rooms)               games, orders, …
       │                                      │
       └──────── @subterfuge/engine ──────────┘
                (same rules code on both sides)
```

There are three workspaces in one npm monorepo:

| Workspace | Role |
|---|---|
| `packages/engine` (`@subterfuge/engine`) | Game rules as pure functions, plus the types shared by server and client (`protocol.ts`). No I/O and no clock. |
| `apps/server` (`@subterfuge/server`) | The authority: runs the simulation, stores state, filters what each player can see, serves the API and the built client. |
| `apps/client` (`@subterfuge/client`) | Angular UI. Renders the game, sends orders, and uses the engine to preview the future (time machine). |

## Principles

### 1. The server is authoritative, and fog of war is enforced there
The browser never receives the full game state. Before anything is sent to a player, the server cuts it down to what that player's sonar can see (goal.md → Visibility). Treat this as a **security boundary**: any field sent to the client can be read by a cheating player.

### 2. One deterministic engine
`@subterfuge/engine` must give the same output for the same input on any machine:
- It uses no `Math.random()`. Use `createRandom(seed)` from `random.ts`.
- It uses no `Date.now()`. Time is passed in as **game minutes** (integers).
- Use integer maths where possible. For example, shields store "progress" rather than fractional charge (see `shield.ts`).

The server runs the engine for real. The client runs it on its *visible* state to preview outcomes and to schedule orders.

### 3. Simulate from event to event, not tick by tick
The game is slow: things happen hours apart. Rather than looping every tick, the simulation keeps a queue of upcoming events and jumps from one to the next. Events include sub arrivals, factory cycles, hire timers and shield milestones. Event times are rounded to 10-minute ticks to match the original game. A per-game **time scale** maps game time to real time, so quick games can run faster. *(Planned.)*

### 4. Orders are an event log, plus snapshots
A game's state is its starting seed plus every order, replayed through the engine. This makes replays, debugging, reconnecting and the time machine straightforward. Periodic snapshots keep replays fast. Scheduled orders are ordinary orders with a future timestamp. *(Planned.)*

### 5. A restart-safe scheduler
Each game stores its `next_event_at` in Postgres. A worker loop wakes games that are due, so a server restart loses nothing. There are no long-lived in-memory timers holding game state. *(Planned.)*

## Request flow

- **HTTP:** Fastify handles `/api/*`. JSON bodies are validated with Fastify's built-in JSON schema support. In production, Fastify also serves the Angular build and falls back to `index.html` for client-side routes.
- **Realtime:** Socket.IO is attached to the same HTTP server. On the handshake it reads the session cookie and rejects unauthenticated sockets. Each user joins a `user:<id>` room so every tab or device gets updates. The event types live in `packages/engine/src/protocol.ts`.
- **Same origin everywhere:** in development, the Angular dev server proxies `/api` and `/socket.io` to the API (see `apps/client/proxy.conf.json`). In production, Fastify serves everything. There is no CORS setup.

## Database

- We use **postgres.js** with tagged-template queries, which are always parameterised. `transform: postgres.camel` maps `snake_case` columns to `camelCase` fields.
- Migrations are plain SQL files in `apps/server/migrations/`. They are applied in filename order at server startup by `src/migrate.ts`, under an advisory lock and in a transaction each. There is no migration library. See [development.md](development.md#database-migrations).

## Dependencies policy

The project must run with `git clone && docker compose up`, without any third-party services. We prefer Node built-ins and small hand-written modules over libraries:
- password hashing uses `crypto.scrypt`
- the rate limiter is hand-written
- `scripts/dev.mjs` replaces `concurrently`
- migrations use a tiny runner instead of a migration tool

Runtime dependencies are deliberately few: Fastify (plus its official cookie and static plugins), Socket.IO, postgres.js and Angular. See [decisions.md](decisions.md).
