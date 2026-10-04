# Subterfuge Reignited — notes for Claude

A web clone of the strategy game Subterfuge.
- **Game rules:** `goal.md`. This is the source of truth for mechanics.
- **Start here when picking up work:** `docs/handoff.md` (current state, lessons learned), then `docs/roadmap.md` (what's next, open decisions).
- **Architecture:** `docs/architecture.md`. Engine details: `docs/engine.md`. API: `docs/api.md`.

## Layout
- `packages/engine/` holds the pure, deterministic rules and the shared wire types (`src/protocol.ts`). It is compiled with tsc, and imports use `.js` extensions.
- `apps/server/` is Fastify + Socket.IO + postgres.js. Node runs the `.ts` source directly, so imports use `.ts` extensions and only erasable syntax is allowed (no enums or parameter properties).
- `apps/client/` is Angular 22. Follow `apps/client/CLAUDE.md`. Use the Angular CLI (`npx ng g ...`) to generate code.

## Rules of the road
- **No third-party services**, and prefer Node built-ins over new dependencies. The project must run with `git clone && docker compose up`.
- **The engine must stay deterministic.** It never uses `Math.random()` or `Date.now()`; time is integer game minutes. Use `createRandom(seed)`.
- **The server is authoritative.** Filter state per player (fog of war) before sending it.
- **Migrations:** add a new `apps/server/migrations/NNN_name.sql` file. Never edit an applied one.
- **Keep the docs current as you go:**
  - `README.md` status checklist
  - `docs/*.md`
  - `docs/decisions.md` for any non-obvious choice
  - `docs/roadmap.md`, whenever priorities change or an item is done
- **Game state changes only through engine orders.** A reload replays orders, so anything changed outside them is lost.
- **Bump `RULES_VERSION`** (`packages/engine/src/constants.ts`) whenever a change alters what `generateMap` or `advance` produce for the same input. Running games started under another version are ended rather than replayed wrongly. Add a line to its history comment.

## Commands (repo root)
- `npm run db:up` starts Postgres. `npm run dev` runs the engine watcher, server (:3000) and client (:4200).
- Before calling work done, run `npm test`, `npm run typecheck` and `npm run build`.
- `docker compose up --build` runs the full app on :3000.
