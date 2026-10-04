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

## 4. Backlog

**See [roadmap.md](roadmap.md).** It's the single list of what's next (in order), with designs already agreed, and a log of what's done.

## 5. Open decisions for the user

Listed in [roadmap.md → Open decisions](roadmap.md#open-decisions-need-the-user).

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
