# Roadmap

This is the one list of what's next, in order. Update it when an item is done or priorities change: move finished items to **Done** with a one-line note. Design details that are already agreed live with each item; the reasons behind decisions go in [decisions.md](decisions.md).

## Now

Nothing queued. Next up is specialists.

## Next: specialists (the main missing game feature)

Only the Queen exists today. Specialists are where most of Subterfuge's strategy comes from.

- **Rules:** goal.md → Specialists.
  - The Queen hires the first specialist at game hour 4, then one every 18 hours.
  - Each offer has 3 choices, one per category, drawn from decks holding 3 copies of each specialist.
  - Promotion is an alternative to hiring.
  - The full effect table is in goal.md.
- **Suggested first batch** (simple, visible effects; needs the user's OK, see open decisions):
  - **Navigator:** redirect a sub after launch. The disabled "Redirect" button already exists.
  - **Helmsman:** 2× speed.
  - **Lieutenant → General:** destroy enemy drillers in combat.
  - **Inspector → Security Chief:** shields.
  - **Princess:** takes over if the Queen is lost. This also unblocks gifting Queens.
  - **Foreman:** extra factory output.
  - **Thief:** steals drillers.
  - **Intelligence Officer:** sonar +25%, and outpost types visible everywhere.
- **Later batch:** Martyr, Double Agent, Pirate, Hypnotist, Revered Elder, Saboteur, Sentry, Smuggler, Assassin, Diplomat, Tinkerer, and the remaining promotions.
- **Engine:**
  - New `SpecialistKind`s.
  - `hire` and `promote` orders.
  - Offers that are deterministic from the seed and stored in the state.
  - Combat's specialist phase with priorities. `combat.ts` currently only uses specialist counts as a tie-break.
  - Speed modifiers in `travelTime` and `subPosition`. House rule when several apply: the fastest wins.
  - **Bump `RULES_VERSION`.**
- **Visibility:** hire offers are visible only to their owner. Specialists are already shown at visible locations.
- **Client:**
  - a hire and promote panel
  - specialist icons on the map and in panels
  - specialist checkboxes in the launch form (they already exist for the Queen)
  - forecasts and battle predictions that include specialist effects
- **How:** contracts first (types and stubs), then parallel agents per specialist group with their own tests. See handoff.md §6.

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

- **First specialist batch:** is the list above right?
- **Domination mode:** build it? If so, what outpost target per player count?

## Done (most recent first)

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
