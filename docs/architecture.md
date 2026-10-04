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

### 3. Fixed 10-minute ticks
Everything in Subterfuge is aligned to 10-minute ticks, so the engine simply steps one tick at a time (`advance` in `simulation.ts`). A 10-day game is about 1,440 ticks, which is cheap. This is simpler than an event queue and just as deterministic. See [engine.md](engine.md).

### 4. Game state = seed + orders, replayed
Postgres stores games, players and orders, never game state. To load a game, the server runs `generateMap(seed)` and replays all orders that weren't cancelled. Scheduled orders are ordinary orders with a future `at`. This makes reconnecting, restarts and debugging simple, and later the time machine too. There are **no snapshots yet**: replaying 90 game days takes about 0.25 s (numbers are in [engine.md](engine.md#performance)). Add them only if loads get slow.

### 5. Game time comes from the wall clock
`game minute = (now − started_at) × speed`. Nothing about the clock is stored or scheduled. The runtime checks every second whether a game has reached a new tick, advances it, and pushes updates. A restart loses nothing: the next load replays to "now".

### 6. Fog of war, and the one deliberate exception
`viewFor` hides everything outside a player's sonar, apart from outpost positions and the type of mines. The exception is the **leaderboard**: every player's Neptunium, outpost count and mines drilled (`PlayerPublic`) are visible to everyone. That mirrors the original game, and makes everyone's next drill cost public. Anything else added to `PlayerView` must be fogged.

## Game runtime (`apps/server/src/games/runtime.ts`)

- On startup and when a game starts, the runtime **loads** the game: it generates the map from the seed and replays the stored orders up to the current tick.
- Every second it **advances** each running game to its current tick. It then sends each player their own `GameSnapshot` (`viewFor` + pending orders + recent visible events) through their private Socket.IO room `game:<id>:<playerId>`.
- **Orders** arrive over Socket.IO:
  1. `parseOrderInput` checks the untrusted payload's structure.
  2. The runtime catches the game up to now and picks the execution time (`LAUNCH_DELAY` for launches).
  3. `validateOrder` checks the rules.
  4. The order is stored in Postgres and added to the pending list.
  - While an order is being written, that game's tick waits, so an order can never land in a tick that has already run.
- **Abuse limits:**
  - 60 order submissions or cancellations per player per real minute
  - at most 100 waiting orders per player
  - scheduling at most 7 game days ahead
  - at most 5 watched games per connection
  These keep the order log, which is replayed on every load, small.
- Each player has their own **event buffer** (the last 100 events they may see). Events are filtered first and trimmed after, so a busy game can't push one player's events out.
- When a player is **eliminated**, their waiting orders are cancelled. When the game **ends** (a win or a draw), it's marked `finished` (`winner` is NULL for a draw).
- **Stale games:** there's no abandon/delete for running games yet. Players can resign, and the last one standing wins. A game everyone stops playing keeps running, which is cheap, but stays in memory.
- The full protocol is in [api.md](api.md).

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
