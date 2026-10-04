-- Accounts and login sessions. See docs/auth.md.

CREATE TABLE users (
  -- UUIDs (not identity ints) because user ids are shown to other players;
  -- uuidv7() is time-ordered, so inserts stay index-friendly (Postgres 18+).
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  username      text NOT NULL CHECK (username ~ '^[A-Za-z0-9_-]{3,20}$'),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Usernames are unique regardless of case ("Alice" and "alice" clash).
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

CREATE TABLE sessions (
  -- SHA-256 of the cookie token; the raw token is never stored.
  token_hash bytea PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
