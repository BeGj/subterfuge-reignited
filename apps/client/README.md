# @subterfuge/client

Angular 22 web client. Coding guidelines: [CLAUDE.md](CLAUDE.md).

- Run it with `npm run dev` from the repo root, which also starts the API. It is served on <http://localhost:4200>, and `/api` and `/socket.io` are proxied to :3000 (`proxy.conf.json`).
- Generate code with the Angular CLI: `npx ng g component pages/my-page`, `npx ng g service core/my-service`.
- Tests: `npm test -w @subterfuge/client` (Vitest).

## Structure

```
src/app/
  core/          app-wide services: Auth (session state), Realtime (Socket.IO), route guards
  pages/         one folder per route, lazy-loaded from app.routes.ts
src/styles.css   global theme tokens (CSS custom properties)
```
