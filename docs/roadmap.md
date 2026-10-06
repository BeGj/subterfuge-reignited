# Roadmap

This is the one list of what's next, in order. Update it when an item is done or priorities change: move finished items to **Done** with a one-line note. Design details that are already agreed live with each item; the reasons behind decisions go in [decisions.md](decisions.md).

## Now

**Specialists batch 1 is built, reviewed and playtested headless** (`RULES_VERSION` 3; deploying ends running v2 games).
A human playtest is still worth doing before deploying. Known small gaps:
- Specialists show on the map as a crown (Queen/Princess) and one dot each, not per-kind glyphs.
- Open question for the user: should a Queen captured in combat be held as a prisoner (goal.md: she becomes your Princess "by gift or Hypnotist") rather than becoming the captor's Princess at once? See specialists.md §9.

## Next: specialists batch 2

- **Rules:** goal.md → Specialists. **Design and mechanisms:** [specialists.md](specialists.md), [engine.md → Specialists](engine.md#specialists).
- Assassin, Infiltrator, Saboteur, Double Agent, Revered Elder, Martyr, Pirate, Smuggler, Sentry, Diplomat,
  Tinkerer→Minister of Energy, Tycoon, War Hero. Each batch is its own `RULES_VERSION` bump.
- Most are table entries in `specialists.ts` plus a tier in `runSpecialistPhase`. The bigger ones: Martyr (outposts
  as wrecks), Pirate (subs as targets), Sentry (a periodic firing step), Tycoon/Tinkerer/Minister (production and
  electrical queries, see specialists.md §3.6).

## Later

- **Chat** (medium). Public and private (any group of players) chat per game.
  - A `messages` table: `game_id`, `from_user`, `recipients uuid[]` (NULL = public), `body`, `created_at`.
  - Socket.IO events and a per-user rate limit.
  - Not game state, so it doesn't go through the engine.
- **Activity tracking: auto-resign and auto-end** (small–medium, build together).
  - `INACTIVITY_AUTO_RESIGN` (48 h) is real time, so the server needs "last activity per player": the newest order or a `watchGame` heartbeat.
  - Auto-resign must be written as a `resign` **order**.
  - The same data enables auto-ending abandoned games.
- **Funding** (goal.md → Funding): a new order plus economy hooks (the constants already exist). Bump `RULES_VERSION`.
- **Domination mode:** a game setting with no mines and an outpost-count win condition. Bump `RULES_VERSION`.
- **Time machine extras:**
  - scrubbing into the **past** (keep received snapshots on the client)
  - an adjustable playback rate
- **Map tuning:**
  - Playtest whether 9.5 h between neighbours at 2 players feels too slow.
  - The 10-player balance spread is 2–4 outposts, against about 2 in the original.
- **Client:**
  - pinch-zoom on touch
  - component-level tests (only helpers and the time machine are tested)
- **Engine:** individual specialist capture and loss events (noted in engine.md).
- **Scaling:** the runtime is in-process, so only one app replica can run (see decisions.md). Needed before running more than one server.

## Open decisions (need the user)

- **Domination mode:** build it? If so, what outpost target per player count?

Specialists were decided on 2026-10-04 and are no longer open; see [specialists.md](specialists.md).

## Done (most recent first)

- **Specialists batch 1** (rules v3): hiring (offers at hour 4 then every 18 h, private per-player decks), promotion (instead of a hire), Queen succession by Princess, and Princess, Helmsman, Lieutenant→General, Thief, Navigator→Admiral (redirect), Foreman→Engineer, Inspector→Security Chief, Intelligence Officer, Hypnotist→King. Hire panel, redirect on the map, names and speeds in the panels, effective shield max in the view.
- **Shield rings:** one ring per 10 shield (10 → 1 ring, 20 → 2, more with the Queen's +20), filling from the inside out. The shield ratio is decided: 1/3 of outposts have 20, the rest 10.
- **End a game by agreement:** a `voteEnd` order (propose or withdraw). The game ends with no winner once everyone still playing agrees; the lobby shows "Ended by agreement" (migration 005). Additive, so no rules version bump.
- **Lobby clean-up:** "Open games" lists only joinable (not full) games. The smoke test ends its own game, and its fog check runs with owners hidden.
- **Unload idle finished games:** dropped from memory after 10 minutes unviewed, and reloaded on demand.
- **Connection robustness:** the client never sits silently on "connecting…". It shows a "can't reach the server" banner, retries refused connections, and asks to log in again when the session has expired.
- **Playtest round 2:**
  - enemy launches visible shortly before they happen
  - per-game setting to show outpost owners outside sonar
  - "refresh to update" banner after deploys
  - trip length instead of a shrinking countdown
  - faint sub trails clipped to your sonar
- **Time machine:**
  - scrub into a forecast built from your own view, with Play and animated jumps
  - orders scheduled at the forecast time (one tick after what's on screen)
  - win/lose/unknown battle icons with summaries, and "Jump to arrival"
  - live prediction while composing a launch
- **Playtest round 1:**
  - one combined sonar area
  - selectable subs with ETA
  - pending orders on the map (edit/cancel)
  - incoming-subs list
  - ambient background
  - disabled shields drain to 0 (rules v2)
- **Rules versioning** (`RULES_VERSION`, migration 003): games started under other rules are ended instead of replayed wrongly.
- **CI, smoke test, lobby rate limits, constant-area maps** (fog of war in small games).
- **Review fixes:**
  - simultaneous production
  - draws and resign
  - order rate limits
  - per-player event feeds
  - replay-determinism test and benchmark
  - database-backed server tests
- **Core game:** accounts, lobby, map generation, simulation, fog of war, game runtime with replay, game screen.
