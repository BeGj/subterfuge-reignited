# Server API

Every endpoint and socket event except registering and logging in requires a session (see [auth.md](auth.md)). All shared types are in `packages/engine/src/protocol.ts` and `types.ts`.

## HTTP

### Auth
`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`. Details are in [auth.md](auth.md).

### Lobby (`apps/server/src/games/lobby-routes.ts`)

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `GET /api/games?before=<id>&limit=<1..100>` | – | `200 GameSummary[]`: unfinished games, plus finished ones you played. Newest first, 50 per page by default. For the next page, pass the last id as `before` | `400` invalid cursor |
| `GET /api/games/:id` | – | `200 GameSummary` | `404` |
| `POST /api/games` | `{ name, maxPlayers, speed, revealOwners? }` (`revealOwners` defaults to true) | `201 GameSummary`; you join seat 1 | `400` invalid, `429` too many created |
| `POST /api/games/:id/join` | – | `204` | `409` started, full or already joined; `429` too many joins |
| `POST /api/games/:id/leave` | – | `204` | `409` started, creator, or not joined |
| `POST /api/games/:id/start` | – | `204`: assigns player ids `p1..pN` in seat order and starts the clock | `403` not the creator, `409` started or fewer than 2 players |
| `DELETE /api/games/:id` | – | `204` | `403` not the creator, `409` already started |

Notes:
- `speed` must be one of `GAME_SPEEDS` (1, 60 or 240 game minutes per real minute).
- Joins lock the game row, so two players racing for the last seat can't both get it.
- Every lobby mutation broadcasts `lobbyChanged` to every socket, so `POST` is rate limited per user: 20 games/hour created, 60/hour joined. Limits are in-memory and reset on restart.
- `GameSummary.endReason` is `won`, `draw` or `rulesChanged` once a game is finished. `rulesChanged` means it started under older rules and was ended instead of being replayed (see `RULES_VERSION` in [engine.md](engine.md#rules-version)).
- Errors are returned as `{ "error": "message" }`.

## Socket.IO

The client connects on the same origin, and the handshake is authenticated with the session cookie.

### Server → client
| Event | Payload | When |
|---|---|---|
| `connect_error` | `unauthorized` or `unavailable` (`CONNECT_ERRORS`) | Connection refused. Socket.IO won't retry these by itself: log in again, or retry later |
| `hello` | `{ user, serverTime, clientBuild }` | On every (re)connect. `clientBuild` is the served client's bundle hash (`null` in dev); a client running a different build shows "refresh to update" |
| `lobbyChanged` | – | Any game was created, joined, left, started, deleted or finished. Refetch `GET /api/games` |
| `gameUpdate` | `GameSnapshot` | To each player of a watched game: every tick, and after their own orders change |

### Client → server (with acknowledgement)
Every acknowledgement is either `{ ok: true, ... }` or `{ ok: false, error }`.

| Event | Arguments | Ack payload |
|---|---|---|
| `watchGame` | `gameId` | `{ snapshot: GameSnapshot }`. Joins your private room for that game |
| `unwatchGame` | `gameId` | (no ack) |
| `issueOrder` | `{ gameId, order: OrderInput, at? }` | `{ pending: PendingOrder }` |
| `cancelOrder` | `{ gameId, orderId }` | `{}` |
| `ping` | – | the server time as an ISO string |

### `GameSnapshot`
```ts
{
  gameId,
  view: PlayerView,              // fog-of-war filtered state (engine viewFor)
  pendingOrders: PendingOrder[], // your orders that haven't executed yet
  clock: { startedAt, speed, serverNow },
  events: GameEvent[],           // your last 100 visible events, oldest first
  imminentLaunches: LaunchOrder[], // enemy launches about to happen that you'd see (still cancellable)
}
```
The current game minute is `(now − startedAt) / 60000 × speed`. Use `serverNow` to correct for the difference between your clock and the server's.

### Orders
`OrderInput` is one of:
- `{ kind: 'launch', from, to, drillers, specialists, isGift? }`. Gifts must target another player's outpost.
- `{ kind: 'drillMine', outpost }`
- `{ kind: 'setShield', outpost, enabled }`
- `{ kind: 'resign' }`: you're eliminated on the next tick and your waiting orders are cancelled.
- `{ kind: 'voteEnd', agree }`: propose (`true`) or withdraw (`false`) ending the game with no winner. It ends once everyone still playing agrees. Votes are public (`PlayerView.endVotes`, `endVote` events).

Limits:
- 60 submissions or cancellations per minute per game
- at most 100 waiting orders
- at most 5 watched games per connection

### What other players see of your orders
- A **launch** becomes visible to another player once it's within `IMMINENT_LAUNCH_WINDOW` (20 game minutes) of executing, if they'd see the sub once launched: it leaves from an outpost inside their sonar, or it's heading for one of their outposts.
  - An immediate launch is therefore visible during its 10-minute launch delay, while you can still cancel it.
  - Scheduled launches stay secret until they get that close.
- Other orders (drill, shield, resign) are never shown before they execute.

### Order timing
- Without `at`, orders run as soon as allowed:
  - launches after `LAUNCH_DELAY` (10 game minutes)
  - other orders on the next tick
- With `at`, the order is scheduled for that game minute, up to 7 *game* days ahead (at speed 240 that's 42 real minutes). `at` must be a multiple of 10 and can't be earlier than "as soon as allowed".
- Immediate orders are checked against the rules straight away. Scheduled ones are checked when they execute; if they fail then, you get an `orderRejected` event.
- An order can be cancelled until it executes.
