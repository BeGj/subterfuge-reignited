-- Rules versioning. A running game is rebuilt by replaying its orders
-- through the engine, so any change to map generation or the simulation would
-- silently rewrite games already in progress. Each game records the
-- RULES_VERSION (packages/engine/src/constants.ts) it started under; the
-- runtime refuses to replay a game under different rules and ends it instead.

-- NULL = started before versioning existed (always treated as outdated).
ALTER TABLE games ADD COLUMN rules_version integer CHECK (rules_version >= 1);

-- Why a finished game ended. NULL for games that haven't ended.
ALTER TABLE games ADD COLUMN end_reason text
  CHECK (end_reason IN ('won', 'draw', 'rulesChanged'));

-- Backfill games that already finished before this column existed.
UPDATE games SET end_reason = CASE WHEN winner IS NULL THEN 'draw' ELSE 'won' END
WHERE status = 'finished';

ALTER TABLE games ADD CONSTRAINT games_end_reason_when_finished
  CHECK ((status = 'finished') = (end_reason IS NOT NULL));
