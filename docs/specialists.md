# Specialists: implementation plan

The design agreed for building specialists. Rules are in [goal.md → Specialists](../goal.md#specialists);
the architecture is in [engine.md](engine.md#specialists) and the API in [api.md](api.md). **Batch 1 is built**
(`RULES_VERSION` 3), including the Hypnotist, because the King can only be reached by promoting him. Batch 2 is next.

Open questions for the user are collected in [Open decisions](#9-decided-need-the-user). Everything
else has a recommendation, marked **R**. **All five were answered on 2026-10-04** (see §9).

## 1. Scope

**Batch 1** (this plan, one rules-version bump; confirmed 2026-10-04):

| Kind | Category | Promotes to | Effect in the engine |
|---|---|---|---|
| queen | – | – | +20 shield where she is; losing her eliminates you (existing) |
| princess | other | – | +50 % sonar at her outpost; becomes Queen if you lose yours |
| helmsman | other | – | 2× travel speed |
| lieutenant | offensive | `general` | −5 enemy drillers in combat; 1.5× travel speed |
| thief | offensive | – | 15 % of enemy drillers (rounded up) to you, in combat |
| navigator | other | `admiral` | the sub may change destination once per 8 h |
| foreman | other | `engineer` | +4 drillers per cycle at factories within half sonar of her outpost |
| inspector | defensive | `securityChief` | recharges her outpost's shield on arrival and after combat |
| intelOfficer | other | – | +25 % sonar for all your outposts; every outpost's type is known |
| general | promoted | – | −10 enemy drillers in any combat where you have a specialist after the specialist phase; 1.5× speed |
| admiral | promoted | – | +50 % speed to all your specialist-free subs; 1.5× himself |
| securityChief | promoted | – | +10 max shield everywhere, +10 more at her own outpost |
| engineer | promoted | – | after every combat you win, repair 25 % (round up) of your lost drillers |
| hypnotist | other | `king` | takes every prisoner held at an outpost his side captures (added: the King's only base) |
| king | promoted | – | 1 enemy driller per 4 of yours after the specialist phase; −20 max shield on your outposts, +20 at his own |

Batch 1 has all the *mechanisms* (hiring, promotion, the combat specialist phase, speed, shields, sonar,
production, Queen succession). Later specialists then mostly add table entries:

- **Batch 2:** assassin (2 at a time), infiltrator, saboteur (2 at a time), doubleAgent, reveredElder, martyr
  (needs outposts that survive as wrecks), pirate (subs as targets), smuggler, sentry (needs a periodic
  2-hourly firing step), diplomat, tinkerer, tycoon, ministerOfEnergy, warHero.
- Each batch is a **rules-version bump of its own**, so the client can read kinds incrementally.

## 2. Contracts (written first, before any behaviour)

### 2.1 New file `packages/engine/src/specialists.ts`

The single source of truth for what a specialist *is*. The engine and the client both read it.

```ts
export type SpecialistCategory = 'offensive' | 'defensive' | 'other';

export interface SpecialistDef {
  /** Display name ("Security Chief"). The id stays terse. */
  name: string;
  category: SpecialistCategory;
  /** One line for the hire card and the panels. */
  blurb: string;
  /** Combat priority: lower acts first. Undefined = no combat-phase effect. */
  priority?: number;
  /** In the hire decks (promoted kinds are not). */
  hireable: boolean;
  /** Copies granted per hire: Assassin and Saboteur are 2. */
  hireSize: number;
  /** Promotion target, or undefined when this kind can't be promoted. */
  promotesTo?: SpecialistKind;
  /** Set on promoted kinds: the base kind it comes from. */
  promotedFrom?: SpecialistKind;
}

export const SPECIALISTS: Record<SpecialistKind, SpecialistDef>;
export const SPECIALIST_CATEGORIES: readonly SpecialistCategory[] = ['offensive', 'defensive', 'other'];
export function specialistName(kind: SpecialistKind): string;
```

`SpecialistKind` in `types.ts` grows from `'queen'` to the batch-1 union; TypeScript then forces us to add a
def for every new kind, and `parseOrderInput` can validate a hire against `SPECIALISTS` instead of a list.

### 2.2 Modifier queries (also in `specialists.ts`, pure functions over the state)

Every place that a specialist changes a number goes through one of these, so nothing drifts:

| Function | Answers | Used by |
|---|---|---|
| `cargoSpeed(kinds, { toOwnOutpost, ownerHasAdmiral })` | fastest speed multiplier (**R**: fastest wins, no stacking — already the house rule in goal.md) | launch, redirect, ETAs |
| `speedOf(state, sub)` | the same, resolved for a sub in flight | `travelTime`, sub panel |
| `shieldMaxAt(state, outpost)` | base max + Queen + Security Chief + King | `chargeShieldsAndMine`, views, rings |
| `sonarRangeAt(state, outpost)` | base × Princess × Intelligence Officer | `visibility.ts`, Foreman radius, Sentry range |
| `productionBonusAt(state, outpost)` | Foreman +4 / Tycoon +3 at one factory | `produce` |
| `productionRate(state, player)` | Tycoon's global rate (**R**: approximated as +50 % drillers per cycle, see §3.6) | `produce` |
| `electricalBonusAt(state, outpost)` | Tinkerer +3 × that outpost's max shield, Minister +300, funding +50 | `produce` |
| `drillerDestroyedInCombat(state, side)` | General −10, King −1 per 4, War Hero −20 | after the specialist phase |

### 2.3 State changes (`types.ts`)

```ts
export interface HireOffer {
  /** Game time the offer appeared. */
  at: GameTime;
  /** One drawn card per category; empty categories are dropped. */
  kinds: Partial<Record<SpecialistCategory, SpecialistKind>>;
}

export interface Hiring {
  /** When the next offer appears (4 h, then every 18 h). */
  nextOfferAt: GameTime;
  /** Remaining cards per category; the drawn ones leave the deck. */
  deck: Record<SpecialistCategory, SpecialistKind[]>;
  /** The offer waiting to be taken, if any. */
  offer: HireOffer | null;
}
```

- `Player.hiring: Hiring` — set by `generateMap`, so the decks are part of the replayed state.
- `Sub.speed: number` — frozen at launch, so ETAs and the map interpolation never disagree.
- `Sub.lastRedirectAt: GameTime | null` — for the Navigator's 8-hour cooldown.
- New orders: `HireOrder { kind: 'hire'; choice: SpecialistKind }`,
  `PromoteOrder { kind: 'promote'; specialist: SpecialistId }`,
  `RedirectOrder { kind: 'redirect'; sub: SubId; to: OutpostId }`.
- New events: `specialistOffered` (private), `specialistHired`, `specialistPromoted`, `queenSucceeded`,
  `specialistCaptured`, `specialistDestroyed` (the last two close the "individual capture and loss events"
  gap in engine.md).
- `PlayerView.hiring` (own hiring only) and `OutpostView.shieldMaxEffective`.
  **Do not** change the meaning of `OutpostView.shieldMax`: `stateFromView` feeds the base value back into a
  `GameState`, where `shieldMaxAt` adds the bonuses again. Sending both avoids double counting in forecasts.
- `RULES_VERSION` → **3**, with a history line: hiring, promotion and specialist effects.

## 3. Engine design

### 3.1 Decks and offers (deterministic)

- **R:** decks are built per player from `createRandom(fnv1a(`${seed}:${playerId}`))` — a private RNG stream, so
  adding hiring does not shift the map generator's draws (map output stays byte-identical, which keeps
  `map.test.ts` meaningful).
- Each category's deck is 3 copies of every hireable kind in it, shuffled.
- At `FIRST_HIRE_AT` (4 h) and every `HIRE_INTERVAL` (18 h) after, one card is drawn per non-empty category.
- **R:** the drawn cards leave the deck whether you take one or not (the other two are lost). The alternative —
  putting unpicked cards back — needs an order for where they go, which the rules don't say.
- **R:** only one offer at a time; a new one replaces the offer you ignored.
- **R:** the offer appears whether or not the Queen is home, but `hire` needs "a free Queen at one of your own
  outposts", so you can't hire while she's travelling or captive.
- New tick step 0, **before** orders execute, so a `hire` can be scheduled for the very tick the offer appears.

### 3.2 `hire` and `promote` execution

Both are ordinary orders: validated when they execute, recorded in `orders`, replayable, cancellable until then
(so the time machine can schedule them). `hire` spawns `hireSize` specialists at the Queen's outpost with
`nextId++`; `promote` mutates the kind of a specialist standing on one of your outposts. Promotion is taken
*instead of* a hire (goal.md), so it needs a current offer and uses it up; the Queen need not be home.
Both report a new event, visible to everyone (only the *offer* is private).

### 3.3 The combat specialist phase

Combat today is a pure arithmetic function of driller counts and specialist *counts*
(`combat.ts`). Specialist effects need to touch the world, so the phase moves into a context, but the
arithmetic stays where it is:

```ts
// specialists.ts
export interface CombatFighter { owner: PlayerId; drillers: number; specialists: Specialist[] }
export interface CombatContext {
  kind: 'outpost' | 'sub';
  /** Where the fight is (ranges, nearest-outpost lookups). */
  at: Point;
  /** The outpost under attack (outpost combat only). */
  outpost?: Outpost;
  /** Subs taking part; a Saboteur rewrites these. */
  subs: Sub[];
  attacker: CombatFighter;
  defender: CombatFighter;
  /** Effects that reach outside the two sides (Martyr, later). */
  effects: { destroySpecialists(specs: Specialist[]): void };
}
export function runSpecialistPhase(ctx: CombatContext): { endsCombat?: 'attacker' | 'defender' | 'draw' } | null;
```

- Specialists act in ascending `priority`; equal priorities act **together** (one tier computed, then applied),
  kinds with no priority never act.
- **R:** `Revered Elder` is checked first as a gate (nobody else acts unless both sides have one).
- After the phase, `drillerDestroyedInCombat` applies General/King/War Hero, then `resolveOutpostCombat` /
  `resolveSubCombat` run on the numbers as they are today.
- Batch 1's effects map to: Lieutenant −5; Thief `ceil(0.15 × enemy drillers)` to your side; Infiltrator drains
  the shield and ends sub combat; Assassin kills every enemy specialist (including a Queen); Double Agent
  swaps owners and drillers; Saboteur redirects and ends combat.

### 3.4 Travel, speed and redirect

```ts
export function travelTime(state, from, to, opts?: { owner?: PlayerId; cargo?: readonly Specialist[] }): GameTime;
```

The base signature still means 1.0× speed, so existing callers and tests keep working. Speed = **fastest**
cargo specialist: Helmsman 2×, Lieutenant/General/Admiral 1.5×, Smuggler 3× but only when `to` is one of the
owner's outposts, Admiral's global +50 % only when the sub carries no specialist at all.

`redirect` validates: your sub, still in flight, carrying a Navigator, `time - lastRedirectAt ≥ 8 h`, a
different target; it rewrites `to`, recomputes `arrivesAt` from the sub's speed and sets `lastRedirectAt`.
The client reuses the map's existing "pick a target" mode (a second signal next to `launchFromId`).

### 3.5 Queen, Princess and elimination

`eliminate()` gets a guard: when a Queen is lost (captured, destroyed, or lost with no outpost to go to), the
owner's **nearest free Princess** becomes the Queen first; only then is the owner eliminated. The reference
point is the lost Queen's position, ties broken by specialist id. A **captured** Queen becomes a Princess of the
captor (goal.md), and gifting her is still rejected: `validateLaunch` keeps "The Queen cannot be gifted", so
Queen trading stays out of v1 (decided 2026-10-04).

### 3.6 Production

`produce()` keeps its simultaneous-cycle shape and adds, per factory:
`6 + foreman + tycoon − minister + funding`, scaled by the Tycoon rate, capped by
`electricalOutput + tinkerer + minister + funding`.

- **R:** Tycoon's "+50 % rate (cycles happen faster)" is implemented as **+50 % drillers per cycle**, so the
  8-hour grid stays shared. Same average output, coarser granularity, and the electrical cap still behaves.
  Per-factory timers would be a much bigger change to the tick loop for no gameplay difference worth the risk.
- Foreman's radius is `SONAR_RANGE / 2`, measured from **her** outpost, and only counts factories.

### 3.7 Shields

`shieldMaxAt` replaces the inline Queen bonus: base + 20 Queen + 10 Security Chief (+10 more at her own
outpost) + King (−20 everywhere, +20 at his own), clamped at 0. Additive between kinds; King's and Security
Chief's own modifiers don't stack with themselves (only one of each exists). Tinkerer drains 3 charge/hour from
her outpost (batch 2). Inspector sets the shield to full on arrival at her owner's outpost and again after any
combat she took part in — skipped while the shield is switched off, matching the existing rule that a disabled
shield sits at 0.

### 3.8 Visibility

`viewFor` swaps the fixed `SONAR_RANGE` for `sonarRangeAt(state, outpost)` (each owned outpost has its own
range now), and an Intelligence Officer anywhere reveals every outpost's type. No rules bump for the view
itself — the specialists that change it do.

### 3.9 Forecast / time machine

`stateFromView` rebuilds `Player.hiring` (from `view.hiring` for `you`, an inert hiring state for everyone
else, so a forecast never invents hires) and keeps sending base `shieldMax`. Everything else — shields, sonar,
speed, production, combat — the forecast picks up from the engine for free. Two cases to test: a Lieutenant on
an arriving sub, and a Security Chief raising an outpost's rings.

## 4. Server

Small and contained:

- `order-input.ts`: `hire` (choice must be in `SPECIALISTS`), `promote`, `redirect`, with the same structural
  checks as today.
- `runtime.ts`: `eventVisibleTo` cases (`specialistOffered` is private to its owner; the rest are public), and
  `redirect` executes on the next tick rather than after `LAUNCH_DELAY`. No new persistence: offers live in
  the replayed state, not in a table.

## 5. Client

1. **`hire-panel`** (new component, one card in the sidebar): the current offer as one card per category
   (name, blurb, icon, Hire), the countdown to the next offer, and a promotion list (your specialists on your
   outposts that can be promoted, with their target kind). Reuses `TimeMachine.scheduleFor` /
   `validateScheduled`, like the outpost panel, so hires can be scheduled and are previewed.
2. **Names everywhere** replace `kind === 'queen' ? 'Queen' : kind` with the engine's `specialistName`.
3. **Map**: the crown stays for the Queen; other specialists get a small glyph beside the outpost name and on
   subs (subs already show `+N★`). Status panel gets a "Your specialists" list with location and promotability.
4. **Launch form**: specialist checkboxes gain their real name, and speed specialists show "2× speed". The ETA
   uses the engine's speed rules, so a Helmsman's trip is right in the panel, on the map and in the forecast.
5. **Sub panel**: the disabled Redirect button becomes live when the sub carries a Navigator with its cooldown
   spent.
6. Nothing about the *view* is invented client-side any more: `shieldMaxEffective` and `hiring` arrive in the
   snapshot.

## 6. Tests

| Area | File | What it must cover |
|---|---|---|
| Catalogue | `specialists.test.ts` | every kind has a def; hireable kinds sit in exactly one category; promotion chains are valid; `hireSize` sane |
| Hiring | `hiring.test.ts` | deck determinism from the seed; first offer at 4 h then every 18 h; drawn cards leave the deck; hire needs a Queen on one of your outposts; `hireSize` copies; promotion needs an outpost; replay gives identical offers |
| Combat | `combat-specialists.test.ts` | priorities and tiers; Lieutenant/General/King numbers; Thief rounding; Queen killed by an Assassin promotes a Princess; a draw still returns specialists home |
| Movement | `movement-specialists.test.ts` | fastest-wins; Smuggler's conditional 3×; Admiral's global on specialist-free subs; redirect cooldown and arrival recomputation |
| Economy | `economy-specialists.test.ts` | Foreman radius and cap; Tycoon rate; Tinkerer electrical and drain; funding + specialists |
| Shields & sonar | `shield.test.ts`, `visibility.test.ts` | Queen/Chief/King; Princess and Intelligence Officer ranges; IO type reveal |
| Forecast | `forecast.test.ts` | hiring round-trips into `stateFromView`; a specialist changes a prediction; no double-counted shield |
| Replay | `replay.test.ts` | unchanged and still byte-identical with hires in the log |
| Server | `order-input.test.ts`, `runtime.db.test.ts` | new kinds parse and reject junk; a hire end to end |
| Client | `helpers.spec.ts`, `time-machine.spec.ts` | specialist names, ETAs with speed, a scheduled hire |

Performance: `node packages/engine/bench/replay-bench.mjs` before and after; the per-tick scans over
`state.specialists` should be invisible (a game holds tens of them, not thousands).

Smoke: `scripts/smoke.mjs` gets a specialist step — wait for the 4-hour offer at blitz speed, hire it, and
assert it appears in the snapshot at the right outpost.

## 7. Docs to update as we go

`engine.md` (catalogue, modifier table, combat phase, simplifications list, API table), `api.md` (three new
orders, `hiring`/`shieldMaxEffective` in the snapshot, new events), `decisions.md` (offer semantics, fastest-wins,
Tycoon approximation, Queen→Princess and gifts, `shieldMaxEffective`), `roadmap.md`, `README.md`, `handoff.md`,
and `goal.md`'s open question "which specialists in v1" once answered.

## 8. Work packages

Contracts first (main session), then parallel agents with exclusive file ownership, per handoff.md §6:

| # | Package | Owns |
|---|---|---|
| 0 | Contracts: `types.ts`, `constants.ts`, `specialists.ts` (catalogue + stubs), `index.ts`, `RULES_VERSION` 3 | main session |
| 1 | Modifiers + specialist phase | `specialists.ts`, its tests |
| 2 | Orchestration: hire/promote/redirect, combat call sites, Inspector, production, `map.ts` decks | `simulation.ts`, `map.ts`, `economy.ts`, `hiring.ts`, tests |
| 3 | Visibility + forecast | `visibility.ts`, `forecast.ts`, tests |
| 4 | Server | `order-input.ts`, `runtime.ts`, tests |
| 5 | Client | new `hire-panel`, panels, map renderer, sub panel, tests |
| 6 | Integration: `combat.ts` edits, smoke, docs, full `npm test`/`typecheck`/`build` | main session |

Packages 3–5 depend on 0 only; 1 and 2 must land together (2 calls what 1 defines) — so run 1 and 2 as one
agent if there aren't enough hands.

## 9. Decided (need the user)

All five were settled on 2026-10-04, and are recorded in [decisions.md](decisions.md) as they're implemented:

1. **Batch 1 list** — as in §1, confirmed.
2. **Offer semantics** — as in §3.1: unpicked cards leave the deck, one offer at a time, and hiring needs the
   Queen at one of your own outposts.
3. **Queen gifts** — **not allowed**. A captured Queen still becomes the captor's Princess; gifting her stays
   rejected for now.
4. **Tycoon's rate** — +50 % drillers per cycle, as proposed in §3.6.
5. **King's shield** — −20 max shield on all your outposts except his own (+20 there), floored at 0.