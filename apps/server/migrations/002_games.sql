-- Games, their players, and player orders. See docs/architecture.md.
--
-- A running game's state is never stored directly: it is rebuilt by
-- replaying `orders` through the engine from `seed`. Game time is derived
-- from the wall clock: (now - started_at) * speed.

CREATE TABLE games (
  -- UUID because game ids appear in URLs and are shared between players.
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  status         text NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'running', 'finished')),
  max_players    smallint NOT NULL CHECK (max_players BETWEEN 2 AND 10),
  -- Game minutes per real minute: 1 = real time (multi-day games).
  speed          integer NOT NULL CHECK (speed BETWEEN 1 AND 1440),
  -- Map seed, set when the game starts. Kept within int4 so JS gets a number.
  seed           integer CHECK (seed >= 0),
  created_by     uuid NOT NULL REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  -- Engine player id of the winner (see game_players.player_id).
  winner         text,
  CHECK ((status = 'lobby') = (started_at IS NULL)),
  CHECK ((status = 'lobby') = (seed IS NULL))
);

CREATE INDEX games_status_idx ON games (status);
CREATE INDEX games_created_by_idx ON games (created_by);

CREATE TABLE game_players (
  game_id   uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users (id),
  -- Join order (lowest free seat). Decides player order at start.
  seat      smallint NOT NULL CHECK (seat BETWEEN 1 AND 10),
  -- Engine player id ('p1', 'p2', ... in seat order), assigned at start.
  player_id text CHECK (player_id ~ '^p[0-9]+$'),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id),
  UNIQUE (game_id, seat),
  UNIQUE (game_id, player_id)
);

CREATE INDEX game_players_user_id_idx ON game_players (user_id);

CREATE TABLE orders (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id      uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  -- Engine player id ('p1', ...), so replays don't need user lookups.
  player_id    text NOT NULL,
  -- Game minute the order executes at. Must be a multiple of TICK in
  -- packages/engine/src/constants.ts; src/games/schema-coupling.test.ts
  -- fails if the two ever disagree.
  at_minute    integer NOT NULL CHECK (at_minute >= 0 AND at_minute % 10 = 0),
  -- The engine Order (kind-specific fields), as JSON.
  payload      jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);

-- Replay reads a game's live orders in execution order.
CREATE INDEX orders_game_replay_idx ON orders (game_id, at_minute, id) WHERE cancelled_at IS NULL;
