-- Per-game setting: show who owns every outpost, even outside sonar (only
-- ownership; drillers and shields stay hidden). On by default, like the
-- original game. See docs/decisions.md.
ALTER TABLE games ADD COLUMN reveal_owners boolean NOT NULL DEFAULT true;
