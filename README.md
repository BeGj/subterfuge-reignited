# Subterfuge Reignited

A web-based clone of the underwater strategy and diplomacy game **Subterfuge**. Players capture outposts, build drillers, hire specialists and race to mine 200 kg of Neptunium. Games run in real time over days, so orders can be scheduled ahead.

- **Game rules:** [goal.md](goal.md)
- **How the code fits together:** [docs/architecture.md](docs/architecture.md)

## Quick start

All you need is Docker.

```sh
git clone <this repo>
cd subterfuge-reignited
docker compose up
```

Open <http://localhost:3000>, create an account, and you're in.

No external services or accounts are needed. Everything (Postgres, the server, the web client) runs from this repository.

To stop it, run `docker compose down`. Add `-v` to also delete the database.

## Development

You need Node 24+ and Docker (for Postgres).

```sh
npm install
cp .env.example .env
npm run db:up       # Postgres in Docker
npm run dev         # engine watcher + API server + Angular dev server
```

Open <http://localhost:4200>. See [docs/development.md](docs/development.md) for details, scripts and troubleshooting.

## Repository layout

```
packages/engine/   Pure, deterministic game rules + shared types (used by server AND client)
apps/server/       Node + Fastify HTTP API, Socket.IO, Postgres (postgres.js)
apps/client/       Angular 22 web client
docs/              Architecture, development and auth docs, decision log
goal.md            The game rules we're implementing, with sources
```

## Documentation

| Doc | What's in it |
|---|---|
| [goal.md](goal.md) | Full game rules, specialist list, tech stack summary |
| [docs/architecture.md](docs/architecture.md) | How the pieces fit together and why |
| [docs/development.md](docs/development.md) | Local setup, scripts, testing, adding migrations |
| [docs/auth.md](docs/auth.md) | How login, sessions and socket authentication work |
| [docs/engine.md](docs/engine.md) | Engine API, units, simulation order, simplifications |
| [docs/api.md](docs/api.md) | HTTP and Socket.IO API reference |
| [docs/decisions.md](docs/decisions.md) | Log of technical decisions and their reasons |

## Status

- [x] Monorepo, Docker setup, migrations
- [x] Accounts: register, log in, log out, sessions
- [x] Authenticated Socket.IO connection
- [x] Engine: constants, combat resolution, shields, production, mining maths
- [x] Map generation
- [x] Game simulation (ticks, subs, combat, production, mining, wins) and fog of war
- [x] Lobby: create, join, leave, start games
- [x] Game runtime: replay from orders, live updates, order and cancel API
- [x] Game screen: canvas map, outpost panel, launch / drill / shield orders, pending orders, players, events
- [ ] Specialists (hiring, promotion, abilities; only the Queen exists so far)
- [ ] Time machine
- [ ] Chat
