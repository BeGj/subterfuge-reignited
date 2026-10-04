-- Games can end by agreement of all remaining players ('agreed').
ALTER TABLE games DROP CONSTRAINT games_end_reason_check;
ALTER TABLE games ADD CONSTRAINT games_end_reason_check
  CHECK (end_reason IN ('won', 'draw', 'agreed', 'rulesChanged'));
