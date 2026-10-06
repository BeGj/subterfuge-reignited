# Deployment

`docker compose up` serves the whole game on one origin (port 3000): the Angular client, `/api` and Socket.IO. Nothing else is needed: no accounts, no external services.

## Self-hosting on your own machine or LAN

Run `docker compose up -d` and open `http://<machine>:3000`. The defaults suit this:

- Plain HTTP, open sign-up.
- Postgres is only published on `127.0.0.1`, because its password in `docker-compose.yml` is a public default.
- Security headers, the Socket.IO origin check and request size limits are always on and need no setup.

## Optional settings (`.env`)

Create a `.env` next to `docker-compose.yml` (it is git-ignored). All of these are optional:

| Variable | Default | When to set it |
|---|---|---|
| `REGISTRATION_CODE` | empty (open sign-up) | Only people with this invite code can create accounts. Existing accounts are unaffected. |
| `COOKIE_SECURE` | `false` | `true` when players reach the game over HTTPS. Logging in over plain HTTP then stops working, except on `localhost`. |
| `TRUST_PROXY` | `false` | The IP of your reverse proxy, so rate limits see real client IPs. Prefer the IP over `true`: with `true`, anyone who can reach port 3000 directly can forge `X-Forwarded-For`. |
| `APP_PORT` | `3000` | Publish the app on another host port. |

Apply changes with `docker compose up -d`.

## Putting it on the internet

Put any HTTPS reverse proxy in front of port 3000 (Caddy, nginx, Traefik, a Cloudflare Tunnel, ...). It must pass WebSocket upgrades and keep the original `Host` header; the Socket.IO origin check compares it with the browser's `Origin`. Then set `COOKIE_SECURE=true`, `TRUST_PROXY=<proxy IP>` and, for a private server, `REGISTRATION_CODE`.

### Example: an existing Cloudflare Tunnel

If `cloudflared` already runs elsewhere on the network:

1. In the Cloudflare dashboard (**Zero Trust → Networks → Tunnels → your tunnel → Public Hostname**), add a hostname such as `game.example.com` with service **HTTP** and URL `<docker-host-LAN-IP>:3000`. WebSockets work through tunnels without extra settings.
2. Set `COOKIE_SECURE=true` and `TRUST_PROXY=<cloudflared host IP>` in `.env`, then `docker compose up -d`.
3. Optionally, add a Cloudflare Access application for the hostname, e.g. a *bypass* policy that only admits some countries.

### Notes

- The app container can reach the rest of your LAN. If the game shares a network with things like home automation, consider a separate VLAN or a firewall rule for the Docker host.
