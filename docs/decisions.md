# Decision log

Short records of technical decisions: what we chose, and why. Newest first. Add an entry whenever a choice would surprise a newcomer.

---

### 2026-10-04 — The client never sits silently on "connecting…"
**Decision:**
- The server refuses sockets with `unauthorized` (no valid session) or `unavailable` (the session lookup failed, e.g. during a deploy). The codes are listed in `CONNECT_ERRORS`.
- Socket.IO doesn't retry refused connections, so the client does it: `unavailable` → retry with backoff (1, 2, 4… up to 10 s); `unauthorized` → "Your session has ended. Log in again".
- When a tab becomes visible again or the network comes back, the client reconnects at once.
- After 15 s without a connection it shows "Can't reach the server…" with a Reload button. The countdown starts when the connection is first lost; retries don't restart it.
**Why:** a playtester's tab stuck on "connecting…" after a deploy, with no update banner. A refused or throttled reconnect left no visible way out. All three paths (outage, new version, expired session) were verified in a browser by stopping, redeploying and invalidating the session.

### 2026-10-04 — Enemy launches are visible shortly before they happen
**Decision:** another player's launch order is shown when it's within `IMMINENT_LAUNCH_WINDOW` (= launch delay + one tick = 20 game minutes) of executing, if you'd see the sub once launched. That means it leaves from inside your sonar, or it's heading for one of your outposts. It's drawn as a warning route, listed on the target outpost, and fed into your forecast and battle predictions.
**Why:** playtest request: players should get a heads-up, and testing a strategy "now" should carry a risk of being seen even though the order is still cancellable. Scheduled orders stay secret until they get close, so the time machine is still useful for planning.
**Not a rules change:** only views change, so no `RULES_VERSION` bump.

### 2026-10-04 — Outpost owners outside sonar: a per-game setting
**Decision:** `games.reveal_owners` (migration 004, default true) makes `viewFor` include the owner of every outpost. Drillers and shields stay hidden. It's chosen when creating a game.
**Why:** in the original game you can usually see who owns an outpost outside your sonar; the playtester asked for it to be toggleable per game. It doesn't change simulation results, so no rules version bump.

### 2026-10-04 — "Refresh to update" when the client is outdated
**Decision:** the server sends the hash of the client bundle it serves (from `main-<hash>.js` in `index.html`) in `hello` on every connect. A client running a different bundle shows a refresh banner.
**Why:** after a deploy, players reconnect automatically but keep running the old JavaScript, which may not match the server any more. Using the bundle hash needs no build tooling, and it only triggers when the client actually changed (server-only deploys don't nag).

### 2026-10-04 — Planned launches show trip length, not a countdown
**Decision:** before a sub launches, labels say "travel 11h 40m · arrives ~Day 2, 03:40" instead of "arrives in …".
**Why:** playtest bug. The launch only happens after the launch delay, so a countdown from "now" shrank while you were still choosing a target, then jumped back up every tick.

### 2026-10-04 — Time machine runs the engine on the player's own view
**Decision:**
- The client builds a forecast from its `PlayerView` (`stateFromView`) and runs `advance` forward with its pending orders.
- While scrubbing forward, the forecast is advanced step by step from the last computed tick. It's rebuilt when the view or the orders change.
- Orders issued while scrubbed run on the tick **after** the one on screen (never earlier than the server allows), and are checked against the forecast with `validateOrder` first.
  - The map shows the state after a tick, including its arrivals, but an order for tick T runs at the start of T, before T's arrivals.
  - Scheduling one tick later makes the order act on exactly what you see. For example: jump to your sub's arrival, then launch the arrived drillers onward.
  - Found in playtest: scheduling at the arrival tick itself was rejected with "Not enough drillers".
**Why:**
- It's the original game's behaviour ("the simulated future only takes into account what you know").
- It needs no server support beyond scheduled orders, which already existed.
- It can't leak hidden information, because the input is already fog-filtered.
**Consequence:** predictions can be wrong when enemies act or when things are hidden. The UI says so, and fights against hidden outposts show as unknown.

### 2026-10-04 — Disabling a shield drains it (rules v2)
**Decision:** turning a shield off sets its charge to 0 and stops charging; turning it on recharges from 0. A captured outpost's shield is switched on for the new owner. `RULES_VERSION` went to 2.
**Why:** playtest feedback: "I disabled a shield, but it still said 2/10". The original forums are offline. The rulebook says disabling exists for trading or gifting outposts, which only makes sense if the charge goes to 0, and a surviving forum snippet describes the shield staying down until re-enabled. Previously a disabled shield kept charging and only stopped fighting, which looked broken.
**Consequence:** games started under rules v1 are ended on the next server start (by design, see rules versioning).

### 2026-10-04 — Rules versioning: games end instead of replaying under new rules
**Decision:**
- The engine has `RULES_VERSION`, and every game stores the version it started under (`games.rules_version`, migration 003).
- When the runtime loads a game whose version differs, it doesn't replay it. It marks it `finished` with `end_reason = 'rulesChanged'`, and the lobby shows "Ended: the rules were updated".
- Bump the version whenever map generation or simulation results change.
**Why:** a game is rebuilt by replaying its orders, so changing `map.ts` or `advance` silently rewrote running games on the next restart. This was found in review: after the constant-area map change, a pre-existing game's stored launch was rejected ("You do not own the launch outpost") and an earlier capture vanished from its history.
**Alternative not taken:** keeping old rule versions runnable side by side (versioned engines). It's worth it after release, when ending players' games is no longer acceptable. Pre-release, ending them is fine.

### 2026-10-04 — Map area is constant, outpost density is not
**Decision:** every game is `mapSize(10) = 4000` units square regardless of player count (`SPACING_SCALE_EXPONENT = 0.5` in `map.ts`). Extra players crowd the same map with more outposts.
**Why:** goal.md originally said "keep outpost density the same for any player count", which makes the map *smaller* with fewer players. Sonar range is an absolute distance, so that put a 2-player game's entire map inside one player's sonar: measured with `npm run map:stats`, a player saw 99 % of the map, and 91 % at 6 players. Fog of war is a core mechanic and it was simply absent from small games.
**Trade-off, measured (`npm run map:stats`):**

| players | map | neighbour travel | sonar rings | map seen (worst / best player) |
|---|---|---|---|---|
| 2 | 4000 | 9.5 h | 2.8 | 76 % / 59 % |
| 4 | 4000 | 8.1 h | 3.3 | 83 % / 39 % |
| 6 | 4000 | 7.7 h | 3.5 | 79 % / 41 % |
| 10 | 4000 | 6.3 h | 4.3 | 72 % / 32 % |

Constant area costs small games some travel time (9.5 h between neighbours at 2 players, versus 6.7 h under constant density) and buys fog everywhere. `SPACING_SCALE_EXPONENT` is the dial; 0.75 would give 2-player games even less visibility (36–60 %) for 12 h trips, which felt too slow to be worth it.
**Note:** 10-player geometry is identical for every value of the constant, so this decision only affects games with fewer than 10 players.
**Assumption flagged:** the original's exact map sizing could not be checked (the rulebook pages are unreachable from here), so this is tuned against the *sonar rings* figure (≈3–4 neighbouring rings) that goal.md records, not against a quoted map size.

### 2026-10-04 — Single replica only: the game runtime lives in memory
**Decision:** `apps/server/src/games/runtime.ts` keeps every live game's state in the server process, keyed off the wall clock and guarded by an in-process `busy` flag. Run **one** app instance.
**Why:** the whole design leans on this. Game state is rebuilt from seed + orders rather than shared, so two processes would derive two different states for the same game from the same rows, both would advance it, and `finish()` would be a last-write-wins race. Nothing in the schema prevents this, so the constraint has to be documented.
**Revisit if** we ever need horizontal scaling: the runtime would move behind a per-game Postgres advisory lock (as `migrate.ts` already does), or state would have to be stored rather than replayed. Scaling the compose file before then silently corrupts games.

### 2026-10-04 — Lobby mutations are rate limited
**Decision:** `lobby-routes.ts` limits game creation and joining per user (20/hour and 60/hour), reusing `auth/rate-limit.ts`.
**Why:** every lobby mutation broadcasts `lobbyChanged`, which makes every connected client refetch `/api/games`. Without a limit, one authenticated script becomes a refetch storm for every browser in the deployment, on top of growing the `games` table.
**Consequence:** limits are per user, not per IP, and are in-memory, so they reset on restart and don't apply across replicas. Same caveat as the login limits; move them into Postgres if the rate limiter ever does.

### 2026-10-04 — CI runs test, typecheck, build, replay bench and docker build
**Decision:** `.github/workflows/ci.yml` runs the §7 checklist on pushes to `main` and on PRs, with a Postgres 18 service so the DB-backed tests don't skip themselves.
**Why:** the three workspaces share `packages/engine`, so a change in one can break another with no local signal. The DB tests skip when Postgres is down, which would silently drop 18 tests without the service. The Docker job catches what `npm test` can't: the image compiles the Angular bundle and runs the server's TypeScript directly.

### 2026-10-04 — Known limitation: loaded games are never unloaded
**Status: planned** (fix tracked in [handoff.md §4.1](handoff.md)).
**Decision:** `GameRuntime.games` only ever grows. Finished games, and finished games opened for viewing, stay in memory.
**Why it's acceptable for now:** we're pre-release with few games. A reload is cheap (see the replay numbers above) and the next `get()` would rebuild it anyway.

### 2026-10-04 — Ending stale games will be an agreed engine order, not a status flag
**Status: planned, design agreed** (see [handoff.md §4.2](handoff.md)).
**Decision (not built yet):** a `voteEnd`-style order. When all remaining players agree, the engine ends the game with no winner, reusing the draw path.
**Why:**

- It has to be an order so replays reproduce it.
- Not creator-only, because a losing creator could otherwise wipe out everyone else's game.
- No new DB status is needed: `finished` with `winner = NULL` already covers it.

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
