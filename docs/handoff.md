# Handoff: state of the project and what's next

**Read this first if you're picking up the project.** It covers what exists, what was decided, what's still open, and the lessons that will save you time. Last updated: 2026-10-04 (after commit `292c33b`).

## 1. Where things stand

The game is **playable end to end**:
1. Sign up.
2. Create, join and start a game in the lobby.
3. Play on a live map: send drillers, capture outposts, drill mines, toggle shields, resign.

Games survive server restarts. Everything runs with `docker compose up` (see [README](../README.md)).

| Area | State | Where |
|---|---|---|
| Accounts | Done. Username + password, Postgres sessions, rate limits | `apps/server/src/auth/`, [auth.md](auth.md) |
| Rules engine | Map generation; tick simulation (subs, combat, production, shields, mining, eliminations, resign, wins, draws); fog of war | `packages/engine/src/`, [engine.md](engine.md) |
| Lobby | Create, join, leave, start, delete; keyset pagination | `apps/server/src/games/lobby-*.ts` |
| Game runtime | In-memory, rebuilt from seed + orders; game time from the wall clock; per-player snapshots over Socket.IO; abuse limits | `apps/server/src/games/runtime.ts`, [architecture.md](architecture.md) |
| Client | Login, lobby, game screen (canvas map, panels) | `apps/client/src/app/` |
| Tests | 153: 79 engine (incl. replay determinism), 61 server (20 need Postgres), 13 client (helpers only), plus `npm run smoke` | `npm test` |
| CI | Pushes to `main` and PRs: typecheck, tests with a Postgres service, build, replay bench, Docker build | `.github/workflows/ci.yml` |
| Docs | README, goal (rules), architecture, engine, API, auth, development, decision log, this file | `docs/` |

**Only the Queen exists as a specialist.** Hiring, the other 27 specialists, the time machine, chat, funding and domination mode are not built.

## 2. Read these, in this order

1. [`CLAUDE.md`](../CLAUDE.md): project rules for agents (short).
2. [`goal.md`](../goal.md): the official game rules we follow, with sources.
3. [`docs/architecture.md`](architecture.md): how the pieces fit together and the principles.
4. [`docs/engine.md`](engine.md): engine API, units, tick order, **every simplification compared to the official rules**, and performance.
5. [`docs/api.md`](api.md): HTTP and Socket.IO protocol.
6. [`docs/decisions.md`](decisions.md): why things are the way they are. Check it before changing a design.
7. [`docs/development.md`](development.md): setup, scripts, tests, troubleshooting.

## 3. Non-negotiables

These come from the user, or are load-bearing for the architecture:
- **No third-party services.** `git clone && docker compose up` must be enough. Prefer Node built-ins over new dependencies. The user rejected Keycloak and wants built-in auth.
- **The engine is deterministic and pure:** no `Math.random`, no `Date.now`, no `Math.hypot`; use `createRandom(seed)` and `distance()`. Ids come from counters in the state. **`replay.test.ts` must stay green.** Live state must equal a replay of seed + orders.
- **Bump `RULES_VERSION`** when a change alters `generateMap`/`advance` output, otherwise running games would be replayed under the wrong rules (they get ended instead; see `docs/decisions.md`).
- **Every change to game state must go through an order** recorded in the `orders` table, e.g. `resign`. Never change a running game's state from outside the engine. A reload would rebuild it without your change.
- **The server is authoritative** and filters what each player sees (`viewFor`). The only deliberately public data is the leaderboard (`PlayerPublic`).
- **Migrations are append-only.** Add `apps/server/migrations/NNN_name.sql`; never edit an applied one.
- **Keep the docs current:** the README status, the relevant `docs/*.md`, and `docs/decisions.md` for any non-obvious choice. Update this handoff file when priorities change.
- **Commits:** only when the user asks. End messages with the Co-Authored-By line given in the session.

## 4. Backlog, in suggested order

Each item notes the design work already done.

### 4.0 Done since the last handoff
- **CI** (`.github/workflows/ci.yml`): runs §7 on pushes to `main` and on PRs. The Postgres service matters: the DB-backed tests skip themselves when the database is unreachable, so a run without it would silently drop 18 of them.
- **Smoke test** (`scripts/smoke.mjs`, `npm run smoke`): plays a real 2-player game over HTTP and Socket.IO — register, create, join, start, capture of a dormant outpost, and a fog-of-war isolation check. Runs in CI too. This is what would have caught a broken lobby-to-game path.
- **Lobby rate limits**: creating and joining games are limited per user, because each mutation broadcasts `lobbyChanged` and makes every open client refetch the list.
- **Single-replica constraint documented** in `docs/decisions.md`: the runtime is in-process, so a second app replica would derive two divergent states per game. Don't scale the app until that's fixed.
- **Map geometry**: the map is now a constant 4000-unit square at every player count, so small games have fog of war (2 players went from seeing 99 % of the map to 59–76 %). Costs 9.5 h of travel between neighbours at 2 players instead of 6.7 h. `npm run map:stats -w @subterfuge/engine` prints the table; `SPACING_SCALE_EXPONENT` is the dial.

- **Rules versioning** (`RULES_VERSION`, migration 003): games store the rules version they started under. The runtime ends, rather than replays, a game whose version differs, with `end_reason = 'rulesChanged'`. **Bump the version when map/simulation output changes** (CLAUDE.md). Without this, the map change above silently rewrote running games on restart.

- **Playtest round 2:**
  - Enemy launches are visible shortly before they happen (warning routes; included in forecasts).
  - Per-game setting to show outpost owners outside sonar.
  - "Refresh to update" banner when the client is outdated after a deploy.
  - Planned launches show their trip length instead of a countdown.

### 4.1 Unload finished and idle games from memory (small, recommended next)
- **Problem:** `GameRuntime.games` (`apps/server/src/games/runtime.ts`) only ever grows.
  - Finished games stay in memory forever.
  - Opening a finished game (`watchGame`) also loads it, and it never leaves.
- **Plan:** unload a game a while after it ends, or after nobody has watched it for N minutes. The next `get()` reloads it from the order log.
  - Use Socket.IO room membership (`io.sockets.adapter.rooms`) or a last-watched timestamp.
  - Running games must stay loaded, since the loop needs them.
- Add a runtime DB test.
- Record the policy in `docs/decisions.md`.

### 4.2 End a stale game by agreement (small)
- There is currently no way to end a running game except winning, a draw, or everyone else resigning.
- **Agreed design** (from discussion with the user):
  - No new status. A finished game with `winner = NULL` already means "ended, nobody won" (same shape as a draw).
  - Implement it as an **engine order**, e.g. `{ kind: 'voteEnd' }` and its cancellation. When all non-eliminated players have voted, the engine sets `endedAt` with no winner (reuse the draw path). The existing runtime `finish()` then marks the game finished. It must be an order so replays agree (§3).
  - **Not creator-only:** a losing creator could otherwise wipe out everyone else's game. A player who refuses can still be bypassed by others resigning.
- **Client:** a "Propose ending the game" control next to Resign, showing who has agreed.

### 4.3 Specialists (large: the main missing game feature)
- **Rules:** `goal.md` → Specialists (hiring every 18h from game hour 4; offers of 3, one per category; decks with 3 copies of each; promotion). The full table, with effects, priorities and promotions, is in goal.md.
- **Suggested first set** (goal.md open question): Princess, Helmsman, Lieutenant → General, Inspector → Security Chief, Foreman, Thief, Navigator, Intelligence Officer. Do the complex ones later (Martyr, Double Agent, Pirate, Hypnotist, Revered Elder).
- **Engine work:**
  - `SpecialistKind` gains the new kinds.
  - New orders: `hire` (choose from the current offer) and `promote`.
  - The offer must be deterministic from the seed (decks dealt with `createRandom`) and stored in the state.
  - Combat's "specialist phase" (`combat.ts` currently only uses specialist counts as a tie-break) needs priorities.
  - Speed modifiers go into `travelTime` and `subPosition`. Decide how multiple speed bonuses combine; goal.md suggests "fastest wins" as a house rule.
- **Visibility:** specialists at visible locations are already in `PlayerView.specialists`. Hire offers must be visible only to their owner.
- **Client:** a hire panel, specialist icons on the map, and specialist checkboxes in the launch form (they exist already for the Queen).
- **Tip:** do this contracts-first with parallel agents (§6). Types and stubs first, then agents per specialist group, each with its own tests.

### 4.4 Time machine (done; known gaps)
- **Engine:** `forecast.ts` (`stateFromView`, `forecast`, `predictArrivals`), plus combat `details` on combat events.
- **Client** (`pages/game/time-machine.ts`, a service provided per game page): the time bar under the map has Now, Play, +1h, +6h, +1d and a slider.
  - While scrubbed, the map and panels show the forecast, framed in yellow.
  - Orders given while scrubbed are scheduled for that time and checked against the forecast first.
  - Battle icons (green ✓, red ✕, grey ?) open a summary.
  - The sub, pending-order and battle panels have "Jump to arrival", which **animates** through time (eased, 0.5–1.8 s), as do +1h, +6h and +1d. Animation is instant when reduced motion is preferred.
  - In a forecast, other players' leaderboard numbers stay live; the forecast only knows their visible outposts.
  - The launch form shows a live prediction ("Loses: needs about 10 more drillers").
- **Gaps:**
  - No scrubbing into the **past**. It would need the client to keep earlier snapshots.
  - Playback has a fixed rate (`PLAY_RATE`).
  - Predictions ignore enemy plans and anything outside sonar, as the original does.
- Server support exists: `issueOrder` accepts a future `at`, and scheduled orders appear in `pendingOrders`.
- The client needs:
  - a time slider
  - a preview that runs `advance()` on the player's **visible** state plus their pending orders. This needs a "view → simulatable state" adapter; hidden enemy data is simply absent.
  - "schedule at this time" for orders
- Scrubbing into the past would need the history of the player's views. Simplest is to keep received snapshots on the client.

### 4.5 Chat (medium)
- Public and private (any group of players) chat per game.
- **Proposed design:**
  - a new `messages` table: `game_id`, `from_user`, `recipients` (`uuid[]`, NULL = public), `body`, `created_at`
  - Socket.IO events
  - a per-user rate limit (reuse `RateLimiter`)
- Chat is not game state, so it doesn't go through the engine.

### 4.6 Activity tracking: auto-resign and auto-end (small–medium, do both together)
- `INACTIVITY_AUTO_RESIGN` (48h) is not implemented. It's **real** time, so the server needs "last activity per player", e.g. the newest order or a heartbeat on `watchGame`.
- Auto-resign must still be written as a `resign` **order**, so replays match.
- The same data enables auto-ending abandoned games.

### 4.7 Smaller items
- **Funding** (goal.md → Funding): a new order and economy hooks in `economy.ts` (the funding constants already exist).
- **Domination mode:** a game setting that turns off mines and adds an outpost-count win condition.
- **Princess promotion when the Queen is lost.** Gifting Queens is currently rejected because of this.
- **Map tuning:**
  - ~~2-player maps have almost no fog~~ — fixed: constant map area, see §4.0. Worth a human playtest to confirm 9.5 h at 2 players isn't too slow.
  - 10-player balance spread is 2–4 outposts, against about 2 in the original.
- **Client:**
  - pinch-zoom on touch
  - component-level tests (only helpers are tested)
  - narrow-screen layout is untested in a browser
- **Specialist capture and loss events:** individual events are missing (noted in `docs/engine.md`).

## 5. Open decisions for the user

From goal.md, still unanswered:
- **Shield ratio:** 1/3 strong (current) or 2/3 (developer quote). It's `STRONG_SHIELD_SHARE`.
- Which specialists go in the first release (see 4.3).
- Domination mode: whether to build it, and the outpost target per player count.

## 6. How work has been done (lessons for agents)

**Parallel agents, contracts first.** This worked well. The main session writes the types and stub signatures (throwing "not implemented"), then gives each agent **exclusive file ownership**. Tell agents:
- not to edit shared contract files, and to report needed contract changes instead
- to verify with `vitest` and `tsc`
- not to commit
- not to use the browser if another session is using it

**Then the main session integrates and verifies in the browser.**

**Get an independent review before calling work done.** Two reviews caught real concurrency bugs in the runtime: lost orders and missed broadcasts.

**Environment gotchas:**
- **Judge checks by exit code, not by grepping output.** `tsc` and Vitest colour their output, so `grep "error TS"` silently misses errors. This let a type error slip into three commits. Use e.g. `npm run typecheck >/dev/null 2>&1; echo $?`.
- **Shell:** zsh. `$var` holding flags doesn't word-split, and `--include=*.ts` globs fail. Write headers out explicitly, and use `grep -rn pattern dir`.
- **Body-less POSTs:** curl with `-H 'content-type: application/json'` and no body gets a 400 from Fastify. Send no content-type on body-less POSTs. The Angular client already does this.
- **npm 12** blocks dependency install scripts by default. Everything works anyway; that's expected.
- **Stale engine in the client:** if the Angular dev server serves an old engine, delete `apps/client/.angular/cache`. The engine is excluded from pre-bundling, so this should be rare.
- **Ports:** stop the compose `app` container before `npm run dev`; both use :3000.
- **Engine `dist/`:** the server and client import the **built** engine. Run `npm run build -w @subterfuge/engine`, or keep `npm run dev`, which watches it.
- **Server DB tests** create throwaway `sub_test_*` databases and are skipped when Postgres is down. Run `npm run db:up` first.
- Long waits: Bash blocks a bare `sleep` over a minute. Use a script that polls (e.g. a Node script listening for `gameUpdate`), or run it in the background.

**Local state (dev machine only):**
- The original developer's local DB volume has a few test users and games. Don't rely on them: register your own accounts through the UI, or wipe everything with `docker compose down -v`.

## 7. Verification checklist before handing back

1. `npm test`, `npm run typecheck` and `npm run build` all pass (with `npm run db:up` so the DB tests run).
2. For engine changes: `replay.test.ts` passes, and the benchmark (`node packages/engine/bench/replay-bench.mjs`) hasn't regressed badly.
3. For UI changes: check in the browser at `npm run dev` → <http://localhost:4200>, including a narrow width.
4. `docker compose up --build`: health check OK, the app loads, the runtime logs "Loaded game …". Then `docker compose down`.
5. The docs above are updated, including this file's backlog.
