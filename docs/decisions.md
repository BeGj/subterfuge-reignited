# Decision log

Short records of technical decisions: what we chose, and why. Newest first. Add an entry whenever a choice would surprise a newcomer.

---

### 2026-10-04 — Runtime loop, speeds and no snapshots (yet)
**Decision:**
- A 1-second `setInterval` loop advances every running game to its current tick.
- Speeds are fixed presets (`GAME_SPEEDS`: 1×, 60×, 240× game minutes per real minute).
- We don't store state snapshots.
**Why:**
- At 240× a tick passes every 2.5 s, so a 1 s loop keeps updates within a second of real time, and one tick costs about 0.2 ms.
- Presets keep the order-scheduling limits and the UI meaningful.
- Snapshots: full replays take 0.25 s at 90 game days and only reach 1 s at about 380 game days (benchmark in `docs/engine.md`).
**Revisit if:** loads get slow, or games routinely run past a few hundred game days.

### 2026-10-04 — Draws and resignations are part of the engine
**Decision:**
- `GameState.endedAt` marks a finished game. `winner` stays null in a draw, i.e. when everyone left is eliminated in the same tick.
- Resigning is an ordinary `resign` order.
**Why:**
- Before this, a simultaneous double elimination left the game running forever.
- Resignation goes through the order log, so it survives replays like everything else.

### 2026-10-04 — Simultaneous factory production
**Decision:** all of a player's factories produce against the same pre-cycle total. If the room left under the cap is short, it's shared evenly, with any remainder going by ascending outpost id.
**Why:** sequential production made which factory got drillers depend on array order.

### 2026-10-04 — Order abuse limits, and per-player event feeds
**Decision:**
- A per-player order rate limit (60 per real minute, reusing `RateLimiter`), plus a cap of 100 waiting orders per player.
- At most 5 watched games per socket.
- Events filtered per player before trimming.
**Why:** every stored order is replayed on each load, so an unthrottled player could slow every restart. Trimming events globally emptied quiet players' feeds in busy games.

### 2026-10-04 — Keyset pagination for the lobby list
**Decision:** `GET /api/games?before=<id>&limit=<n>`, newest first.
**Why:** game ids are UUIDv7 and therefore time-ordered, so the id itself is a stable cursor, and there's no OFFSET drift.

### 2026-10-04 — Engine excluded from Vite pre-bundling in dev
**Decision:** `angular.json` → `serve.options.prebundle.exclude: ["@subterfuge/engine"]`.
**Why:** the Angular dev server pre-bundles workspace packages like third-party ones and caches them, so engine changes (new exports) weren't picked up. Excluding the engine makes the dev server read its `dist/` directly.

### 2026-10-04 — Runtime pauses a game's ticks while one of its orders is being written
**Decision:** while an order insert or cancel is in flight, nothing advances that game (`busy` counter). The loop broadcasts whenever the state moved past the last published tick, no matter who advanced it.
**Why:** otherwise an order could miss its tick in memory but still execute on replay after a restart, so live and replayed state would differ. Broadcasting on any progress ensures players get an update even when another player's request advanced the game.

### 2026-10-04 — Fixed ticks instead of an event queue
**Decision:** `advance()` steps 10 game minutes at a time, replacing the event-driven simulation we planned earlier.
**Why:** all game events are tick-aligned anyway, and a 10-day game is only ~1,440 ticks. Stepping is simpler to get right and to test, and costs milliseconds.

### 2026-10-04 — Game time is derived from the wall clock
**Decision:** game minute = `(now − started_at) × speed`. There is no stored clock and no `next_event_at` scheduler.
**Why:** it's restart-safe for free (load = replay to now) and needs no timer state in the database.
**Consequence:** games can't be paused yet. Pausing would need a stored offset.

### 2026-10-04 — Game state lives in memory, rebuilt by replaying orders
**Decision:** Postgres stores only games, players and orders. The runtime keeps each running game's state in memory and rebuilds it from seed + orders when it loads.
**Why:** a single source of truth, trivially consistent, and it matches how the time machine will work. Add snapshots if replays get slow.

### 2026-10-04 — `Math.sqrt` instead of `Math.hypot` in the engine
**Decision:** `distance()` uses `Math.sqrt(dx*dx + dy*dy)`.
**Why:** IEEE 754 requires `sqrt` to be correctly rounded; `hypot` isn't, and browsers may differ. Client-side previews must match the server bit for bit.

### 2026-10-04 — Engine work split across parallel agents with contracts first
**Decision:** before parallel work starts, the main session writes the types (`types.ts`) and stub signatures. Each agent then owns specific files.
**Why:** this avoided merge conflicts and mismatched shapes between map generation, simulation and the server runtime.

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
