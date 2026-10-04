# Development

## Prerequisites

- **Node 24+**. The server runs `.ts` files directly using Node's built-in type stripping, so there's no build step for the server.
- **Docker**, for Postgres. It is also all you need to run the full app with `docker compose up`.

## First-time setup

```sh
npm install
cp .env.example .env    # local settings; defaults work out of the box
npm run db:up           # starts Postgres in Docker on localhost:5432
npm run dev
```

`npm run dev` (`scripts/dev.mjs`) builds the engine once, then runs three processes with prefixed output:

| Prefix | Process | Notes |
|---|---|---|
| `[engine]` | `tsc --watch` on `packages/engine` | Rebuilds `dist/` on change |
| `[server]` | `node --watch apps/server/src/main.ts` | API on <http://localhost:3000>. Restarts on change and migrates the DB on start |
| `[client]` | `ng serve` | UI on <http://localhost:4200>. Proxies `/api` and `/socket.io` to :3000 |

Open **<http://localhost:4200>** during development. Ctrl+C stops everything.

## Scripts (run from the repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Engine watcher + server + Angular dev server |
| `npm run build` | Builds the engine and the production Angular bundle |
| `npm test` | Runs the tests in all workspaces (Vitest) |
| `npm run typecheck` | Type-checks all workspaces |
| `npm run db:up` | Starts only Postgres (`docker compose up -d db`) |
| `npm run migrate` | Applies pending migrations without starting the server |

To run a single workspace: `npm run test -w @subterfuge/engine`, `npm run dev -w @subterfuge/server`, and so on.

## Environment variables

These are read by `apps/server/src/config.ts`. `npm run dev` loads them from `.env`, and `docker-compose.yml` sets its own.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://subterfuge:subterfuge@localhost:5432/subterfuge` | Postgres connection |
| `HOST` | `127.0.0.1` | Interface to listen on (`0.0.0.0` in Docker) |
| `PORT` | `3000` | HTTP port |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS |
| `CLIENT_DIST` | `apps/client/dist/client/browser` | Angular build to serve. Skipped if missing |
| `LOG_LEVEL` | `info` | Fastify/pino log level |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for the client IP. Only enable behind your own reverse proxy (`true`, or a comma-separated list of proxy IPs), otherwise clients can spoof their IP and dodge rate limits |

Docker port overrides: `DB_PORT=5433 APP_PORT=8080 docker compose up`.

## Database migrations

- Migrations are plain SQL files in `apps/server/migrations/`, named `NNN_description.sql` (e.g. `002_games.sql`).
- They are applied **in filename order**, each in its own transaction. Applied migrations are recorded in the `schema_migrations` table.
- They run automatically when the server starts. You can also run them with `npm run migrate`.
- **Never edit a migration that has already been applied.** Add a new file instead.

To reset your local database: `docker compose down -v && npm run db:up`.

## Tests

- **Engine:** `packages/engine/src/*.test.ts`. Prefer the rulebook's own worked examples as test cases (e.g. "27 vs 11 drillers leaves 16").
  - `replay.test.ts` is the most important test in the repo. It proves that replaying the same orders gives byte-identical state however the time is chunked, which is what the server's restart model relies on.
  - Benchmark: `npm run build -w @subterfuge/engine && node packages/engine/bench/replay-bench.mjs`.
- **Server:** `apps/server/src/**/*.test.ts`.
  - **Unit tests:** auth, the order parser, event privacy, and the schema↔engine constant check.
  - **Database tests** (`*.db.test.ts`): the lobby store and the game runtime, covering clock mapping, order timing, cancelling, restart replay, the order-write race, broadcasting, limits, resigning and event feeds.
    - Each test file creates and migrates its own throwaway database (`sub_test_…`) and drops it afterwards.
    - They need Postgres (`npm run db:up`). They use `TEST_DATABASE_URL`, then `DATABASE_URL`, then the local default.
    - If no database is reachable they're **skipped**, not failed, so `npm test` works without Docker.
- **Client:** `apps/client/src/**/*.spec.ts`, run through `ng test` (Vitest + jsdom).

## Code conventions

- TypeScript strict mode everywhere (`tsconfig.base.json`). The server and engine use `erasableSyntaxOnly`, so no `enum` and no constructor parameter properties.
- **Server imports use `.ts` extensions** (`import { x } from './y.ts'`) because Node runs the source directly. **Engine imports use `.js`**, because it is compiled with `tsc`.
- The Angular code follows `apps/client/CLAUDE.md`:
  - standalone components, signals, `@Service()`
  - Signal Forms
  - native control flow
  - the default OnPush change detection
- Format with Prettier (`.prettierrc`): 100 columns, single quotes.

## Troubleshooting

- **`npm install` warns that install scripts were blocked.** npm 12 blocks dependency install scripts by default. Everything works without them (esbuild ships prebuilt binaries). You can review the list with `npm install-scripts ls`.
- **The server exits with `EADDRINUSE` on port 3000.** The full app from `docker compose up` is still running. Stop it with `docker compose stop app`, then run `npm run dev` again.
- **Port 5432 is already in use.** Another Postgres is running. Run `DB_PORT=5433 npm run db:up` and update `DATABASE_URL` in `.env` to match.
- **The client fails with "does not provide an export named …" from `@subterfuge/engine`.** The dev server had cached an old engine build. The engine is excluded from Vite pre-bundling (`prebundle.exclude` in `angular.json`), so this shouldn't happen. If it does, delete `apps/client/.angular/cache` and restart `npm run dev`.
- **The client shows a blank page.** Check the browser console and the `[client]` output; Angular errors appear in both.
