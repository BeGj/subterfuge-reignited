# Game engine (`packages/engine`)

The engine holds the game rules as pure, deterministic functions. The server runs it for real; the client imports the same code for previews. The official rules are in [goal.md](../goal.md); this page covers how we implement them and where we simplify.

## Main API

| Function | File | What it does |
|---|---|---|
| `generateMap({ seed, players })` | `map.ts` | Builds the starting `GameState` for a new game |
| `advance(state, orders, until)` | `simulation.ts` | Simulates tick by tick up to `until`. Returns the new state plus the `GameEvent`s that happened. Never mutates its inputs |
| `validateOrder(state, order)` | `simulation.ts` | Returns a reason string if the order is invalid right now, else `null` |
| `travelTime(state, from, to, { owner?, cargo? })` | `simulation.ts` | Travel time between two outposts, rounded up to whole ticks. Without `owner` it's 1.0 speed; with it, the cargo's speed (see Specialists) |
| `subPosition(state, sub, time)` | `simulation.ts` | Where a sub is at a given time, interpolated along its route |
| `viewFor(state, player, { revealOwners? })` | `visibility.ts` | Cuts the state down to what one player may see (fog of war). `revealOwners` (a per-game setting) also shows the owner of outposts outside sonar |
| `stateFromView(view)`, `forecast(view, orders, until)` | `forecast.ts` | The time machine's simulated future, built only from what one player can see |
| `predictArrivals(view, orders)` | `forecast.ts` | For each visible sub and pending launch: arrival time and predicted outcome (`win`, `lose`, `safe`, `unknown`) with battle numbers |
| `resolveOutpostCombat`, `resolveSubCombat` | `combat.ts` | The combat phases |
| `electricalOutput`, `factoryCycleOutput`, `mineDrillCost`, `neptuniumPerDay` | `economy.ts` | Production and mining maths |
| `SPECIALISTS`, `specialistName`, `cargoSpeed`, `shieldMaxAt`, `sonarRangeAt`, `productionBonusAt`, `runSpecialistPhase` | `specialists.ts` | The specialist catalogue and every number a specialist changes |
| `buildHiring`, `refreshOffers`, `validateHire`, `validatePromote` | `hiring.ts` | Hire decks, offers, hiring and promotion |

The types (`GameState`, `Order`, `GameEvent`, `PlayerView`) live in `types.ts`, and the tunable numbers in `constants.ts`.

## Units

- **Time:** integer game minutes since the start. Everything happens on 10-minute ticks (`TICK`).
- **Distance:** map units. A sub at 1.0 speed travels `SUB_SPEED` (1) unit per minute, so sonar range (27 travel-hours) is 1620 units.
- **Neptunium:** integer units, where 1 kg = `NEPTUNIUM_UNIT` (1440) units. Each mine adds (outposts owned) units per minute, which works out to 1 kg per day per outpost.
- **Shields:** integer "progress"; see `shield.ts`. This keeps charging exact without fractions.

## Rules version

`RULES_VERSION` in `constants.ts` identifies the rules (map generation + simulation). Games store the version they started with, and the server ends, rather than replays, a game whose version differs. **Bump it whenever a change alters what `generateMap` or `advance` produce for the same input**, and add a line to the history comment next to it. Pure refactors and performance work that keep `replay.test.ts` byte-identical don't need a bump.

## Determinism rules

The server and every browser must compute identical results from the same inputs:
- **No `Math.random()`.** Use `createRandom(seed)`.
- **No clock.** Time is always passed in.
- **No `Math.hypot`** and other functions whose rounding isn't fully specified. Use `distance()` in `geometry.ts`, which uses `Math.sqrt`.
- **Ids come from counters** in the state (`nextId`), so a replay produces identical ids.

## Forecasts (time machine)

The client predicts the future by running the same engine on the player's **own view** plus their pending orders (`forecast.ts`). Like the original game, it only knows what the player knows:
- Hidden outposts become empty placeholders owned by `UNKNOWN_PLAYER` (`'?'`). That placeholder is marked eliminated so it never mines or wins.
- Fights against hidden outposts are predicted as `unknown`, not as wins.
- Enemy subs outside sonar and enemy future orders don't exist in a forecast.
- Shield charge is rounded down to whole units, because clients don't get fractional progress.

Combat events carry `details` (each side's drillers before and after, specialists, shield before and after), which the battle summaries show.

## Map generation

`map.ts` follows the developer description quoted in goal.md:

1. Place N player centres and push them apart.
2. Place N×10 outposts and push them apart. The map is always `mapSize(10) = 4000` units square, whatever the player count (`SPACING_SCALE_EXPONENT = 0.5` keeps the *area* constant, not the density), so the nearest neighbour is 6–10 travel-hours away depending on player count.
3. Players pick their 5 starting outposts in snake order (1→N, then N→1), taking the unclaimed outpost nearest their centre. The Queen goes on the first pick; the other four get 40 drillers each.
4. Outpost types (30–60% generators) and shield maxes (1/3 strong) are dealt from shuffled decks, round-robin by distance, so players get similar resources.
5. Generate `MAP_CANDIDATES` (150) candidate maps and keep the most balanced one. Balance is measured by assigning every dormant outpost to the nearest starting outpost and comparing outpost counts per player.

Run `npm run map:stats -w @subterfuge/engine` for the table this trades off against: travel time and the share of the map a player can see, per player count.

**Known issues:**
- 10-player maps are less even than the original's: the spread is usually 2–4 outposts rather than 2.
- Constant map area means small games travel further: about 9.5 h between neighbours at 2 players, versus 6.3 h at 10. That is the price of having fog of war at all in a 2-player game; `SPACING_SCALE_EXPONENT` is the dial.

## Simulation: order of events in each tick

0. Draw the hire offers that are due (hour 4, then every 18 h), so a `hire` can run in the same tick.
1. Execute orders whose `at` falls in this tick, in the order given. An invalid order is skipped and reported as an `orderRejected` event.
2. Move subs. Resolve sub-vs-sub encounters (by crossing time), then arrivals (by sub id, i.e. launch order). Then apply this tick's redirects to the subs still in flight.
3. Factory production, every `FACTORY_CYCLE` (8h). All of a player's factories produce **simultaneously** against the same pre-cycle total:
   - If there's room under the electrical cap for everyone's full output, each factory makes 6 (+4 near a Foreman).
   - Otherwise the remaining room is split evenly, and any remainder goes one each to factories in ascending outpost-id order.
   - The cap is never exceeded, and the result doesn't depend on array order.
4. Charge shields and mine Neptunium.
5. Check eliminations, wins and draws.
   - A draw happens when everyone left is eliminated in the same tick.
   - When the game ends, `endedAt` is set (and `winner` too, unless it's a draw). From then on the state never changes.

Orders from eliminated players are skipped silently, and the server also cancels them. A `resign` order eliminates its player, just like losing the Queen.

## Specialists

Rules are in [goal.md → Specialists](../goal.md#specialists); the design is in [specialists.md](specialists.md). Batch 1 is built: Queen, Princess, Helmsman, Lieutenant→General, Thief, Navigator→Admiral, Foreman→Engineer, Inspector→Security Chief, Intelligence Officer and Hypnotist→King.

- **Catalogue:** `SPECIALISTS` in `specialists.ts` holds each kind's name, category, blurb, combat priority, whether it's hireable and its promotion. The client reads the same table.
- **One query per number** a specialist changes, so the engine, views and forecasts agree:

| Query | Effect |
|---|---|
| `cargoSpeed` / `speedFor` | Fastest cargo wins: Helmsman 2×, Lieutenant/General/Admiral 1.5×; an Admiral gives 1.5× to your specialist-free subs. Frozen into `Sub.speed` at launch |
| `shieldMaxAt` | Base + Queen 20 + Security Chief 10 everywhere (+10 more at hers) + King (−20 everywhere, +20 at his), floored at 0 |
| `sonarRangeAt` | Princess +50 % at her outpost, Intelligence Officer +25 % everywhere |
| `revealsOutpostTypes` | An Intelligence Officer shows every outpost's type |
| `productionBonusAt` | Foreman +4 per cycle at factories within half a sonar of her outpost |
| `runSpecialistPhase` | Before the driller phase, by ascending priority; a tier of equal priorities reads the numbers at its start and applies together. Thief takes 15 % (rounded up) when attacking an outpost or in sub-vs-sub, not when defending; Lieutenant destroys 5 |
| `drillerDestroyedInCombat` | After the phase: General −10 (his side needs a specialist in the fight), King −1 per 4 of your drillers |
| `engineerRepair` | After a win: 25 % of the drillers you lost in the whole fight back, +25 % more where an Engineer was present (at the outpost or on the winning sub) |

- **Hiring:** each player has a private deck per category (3 copies of each hireable kind), shuffled from `fnv1a(seed:playerId)` so the map draws don't shift. One card per category is offered at hour 4 and every 18 h; all drawn cards leave the deck and a new offer replaces an ignored one. `hire` needs a free Queen at one of your outposts and spawns there; `promote` changes a specialist in place at one of your outposts. A promotion is taken instead of a hire, so it also needs the current offer and uses it up.
- **Redirect:** a sub carrying a Navigator may change destination once per `NAVIGATOR_COOLDOWN` (8 h), including straight back home. It turns where it is (`Sub.origin`, with `launchedAt` reset to the turn) and the new arrival is measured from there at its frozen speed. The turn happens after that tick's fights and arrivals, so a redirect can't dodge a fight due in the same tick.
- **Inspector:** refills her outpost's shield to the maximum when she arrives there and after every fight while she is present (not while the shield is off).
- **Hypnotist:** when his side takes an outpost he's on, every prisoner held there becomes his owner's.
- **Queen succession:** losing a Queen promotes the owner's nearest free Princess (measured from the lost Queen, ties by id). Only a player with no free Princess is eliminated. A captured Queen becomes the captor's Princess.

## Performance

`packages/engine/bench/replay-bench.mjs` replays a 10-player game with about 10k orders and 40 subs in flight. Run it with `node packages/engine/bench/replay-bench.mjs` after building the engine. Measured on a laptop:

| Game days | Ticks | Full replay (one `advance` call, i.e. a server load) | Live tick |
|---|---|---|---|
| 1 | 144 | 3 ms | ~0.4 ms |
| 7 | 1,008 | 22 ms | ~0.3 ms |
| 30 | 4,320 | 82 ms | ~0.2 ms |
| 90 | 12,960 | 227 ms (~57k ticks/s) | ~0.2 ms |

A replay reaches about 1 second at roughly 55k ticks, or about 380 game days, which is about 1.6 real days of a speed-240 game. Normal games end long before that, so **we don't snapshot yet**. Add snapshots (store the state every N ticks and replay from the latest) if games ever routinely run that long, or if loads get slow.

The replay test (`replay.test.ts`) checks that one `advance` call, tick-by-tick stepping and irregular chunks all produce byte-identical state and events. That is what guarantees the server's live state matches what a restart rebuilds.

## Simplifications compared to the official game

- All events are aligned to 10-minute ticks, and travel time is rounded up to whole ticks.
- Factories all produce at the same moment (every 8 game hours from the start), not on individual timers.
- **Sub-vs-sub fights:**
  - Captured specialists move straight to the winner's nearest outpost instead of travelling there.
  - In a draw, specialists go straight home.
  - If a player has no outpost to send them to, the specialists are lost. A lost Queen passes to a Princess, or eliminates her owner if there is none.
- **Redirected subs:** turning straight back keeps a sub on its lane (it still meets anyone following it); any other turn takes it off every lane, so it meets no other sub on that leg. Subs only ever meet head-on on a lane, as before.
- A gift sub that meets another player's sub hands its cargo to that sub, which carries on. The official game sends the gift home instead.
- Gifts must target another player's outpost; gifts to dormant outposts or your own are rejected.
- **Mines:** losing one takes `floor(20%)` of your stored Neptunium units (1/1440 kg precision). The official game also resets the mine's "production timer". We have no per-mine timer because Neptunium accrues continuously each tick: the previous owner keeps what has accrued, and the captor starts earning on the next tick.
- **Map setup:** starting outposts are picked in a snake draft (1→N, then N→1), each pick taking the unclaimed outpost nearest the player's centre. The official rule is "the 5 outposts nearest each centre" and doesn't say how overlaps are resolved; the draft is our tie-break. Other differences: 150 candidate maps instead of 500, and an approximate balance metric. These are listed at the top of `map.ts`.
- **Inactivity:** auto-resign after 48 hours (`INACTIVITY_AUTO_RESIGN`) is **not implemented**. It's based on real time, so the server would need to track real activity. Players can resign manually.
- A resigned player's Queen stays where she is and still adds +20 shield there (eliminated players' shields keep charging, per the rules).
- Queens can't be gifted (the user's call; Queen trading is out of v1).
- **Disabled shields** drop to 0 and don't charge while off; re-enabling recharges from 0. A captured outpost's shield is switched back on for the new owner. The official sources only say disabling is "useful when trading or gifting outposts", which only works if the charge goes to 0; a surviving forum post agrees (rules v2).
- Dormant outposts never charge their shields and never resist capture.
- **Specialists:** only batch 1 exists (see Specialists above). Batch 2 (Assassin, Infiltrator, Saboteur, Double Agent, Revered Elder, Martyr, Pirate, Smuggler, Sentry, Diplomat, Tinkerer, Tycoon, War Hero) is not built.
- **Not implemented yet:** batch-2 specialists, funding and the domination mode.
