# Subterfuge
We are making a webbased game that is a clone of Subterfuge.

## Gameplay
You might want to google the game yourself, but here is how it goes:
Game about capturing and defending nodes, either win the game by conquering other player nodes, or mine enough to reach the win limit.

> Rules below follow the official rulebook and specialist reference (play.subterfuge-game.com/docs/Rulebook). The fan wiki (subterfuge.fandom.com) fills in details. Where the two disagree, the **official** version is used and the difference is noted.

### Glossary
| Our term | Official term | Meaning |
|---|---|---|
| Node | Outpost | A location on the map that can be owned |
| Troop | Driller | Basic unit, used for combat and for drilling mines |
| Troop limit | Electrical output / energy cap | Max drillers your factories will produce up to |
| Win limit | 200 kg Neptunium | Resource needed to win |
| Sub | Sub | Transport that moves drillers and specialists between outposts |

From here on this document uses the official terms.

---

### Winning and losing
- **Mining victory (default):** the first player to hold **200 kg of Neptunium** wins.
- **Domination variant (optional mode):** there are no mines. The first player to control a target number of outposts wins. The target scales with player count, roughly **30–50 outposts**.
- **Last player standing:** the game also ends when only one player remains.
- **Elimination** happens when a player:
  - loses their Queen (captured or killed) and has no Princess to take over,
  - resigns, or
  - is inactive for 48 hours (auto-resign).
- **Effects of elimination:** the player can't issue orders, and their scheduled orders are cancelled. All their Neptunium is lost and their mines stop producing. Funding they give or receive is cancelled. *Everything else carries on*: their factories still produce, their shields still charge, and their outposts stay on the map as targets.

### Game setup
- **Players:** 2–10.
- **Map generation:**
  1. Create a map whose *area* is the same for any player count, so sonar covers a comparable share of it. ⚠️ We deliberately do **not** keep outpost density constant: sonar range is an absolute distance, so a smaller map has no fog of war at all (at 2 players, constant density put 99 % of the map inside one player's sonar). See `docs/decisions.md`.
  2. Place N player "centres" (N = number of players). These repel each other so they spread out.
  3. Add **N × 10 outposts** at random positions. These also repel each other, but not into a uniform grid.
  4. Each player gets the **5 outposts nearest their centre**. The closest one holds the Queen. The other 4 start with **40 drillers each**.
  5. Pick a generator share between **30% and 60%**; the rest are factories. Build a "deck" of outpost types with that ratio. Deal it out by distance, round-robin across players: each player's nearest unassigned outpost gets the next card. This keeps players' resources similar.
  6. Shield strengths are dealt the same way from a shared shield deck (see Shields).
  7. Generate **500 candidate maps** and keep the most balanced one. Balance test: if every player sent 1 driller to every outpost, which map gives the smallest gap between the player who ends up with the most outposts and the one with the fewest?
- All other outposts start **dormant/neutral**: unowned, with 0 drillers. Any sub can capture one without a fight.
- Every player can see where every outpost is. What an outpost *contains* is only visible within sonar (see Visibility).

### Nodes (Outposts)
There are **3 types of outposts: Factory, Generator and Mine**. The map only generates Factories and Generators. A **Mine** is made by drilling a Factory or Generator you own, which turns it into a Mine for good.

- **Factory:** produces **6 drillers every 8 hours** (one *production cycle*). It stops when you reach your electrical output cap. It doesn't raise the cap.
- **Generator:** adds **+50** to your electrical output (troop limit). It produces nothing.
- **Mine:** produces Neptunium (see Mining). It neither produces drillers nor adds electrical output.

**Electrical output (troop limit)** = **150** (base, from the Queen) **+ 50 per Generator** + modifiers (Funding, Tinkerer, Minister of Energy). Factories keep producing only while your *total* drillers are below this number. The cap doesn't destroy drillers you already own above it; it only stops production.

#### Shields
All outposts have a "regenerating shield".
- Max charge is **10 (weak)** or **20 (strong)**, decided at map generation and fixed for that outpost. Specialists can raise or lower it.
- *Our design:* a third of outposts have max 20 and the rest have max 10 (random modifier).
  - Decided: 1/3 strong (20), 2/3 weak (10). The sources disagree (a developer quote says 2/3 strong), but this matches the wiki outpost page and the user's choice. It's `STRONG_SHIELD_SHARE`.
- Shields take **48 hours to charge from 0 to full, whatever the max**. A 20-shield outpost therefore gains ~0.42/h and a 10-shield outpost ~0.21/h.
- All shields **start the game at 0**.
- The owner can **turn the shield off** and back on. This is useful when trading or gifting an outpost. *Our implementation:* turning it off drops the charge to 0 and stops charging; turning it on recharges from 0 (see `docs/engine.md`).
- In combat, the shield destroys attacking drillers one-for-one and loses that much charge (see Combat).

### Subs (movement)
- Subs carry drillers and/or specialists from one outpost to another. They are created on demand, so there's no sub resource.
- A sub **launches 10 minutes after the order**. Until then the player can change what it carries or cancel it.
- Once launched, a sub **can't be recalled or re-routed** unless it carries a Navigator.
- Base speed is the same for all subs; specialists modify it. Distances are measured in **travel-hours at 1.0 speed**.
- **Encounters:** two subs only meet in transit if they are **travelling between the same two outposts** in opposite directions. Subs with crossing paths elsewhere don't meet. A Pirate is the exception: it can target a specific sub.
- Arriving at your own outpost: the cargo unloads into it.
- Arriving at an enemy outpost: combat.
- Arriving at a dormant outpost: you capture it without a fight. Even 1 driller is enough.

#### Gifts
- Any sub can be marked as a **gift**. You can cancel this within 10 minutes.
- A gift sub that reaches an outpost hands all its drillers and specialists to that outpost's owner.
- A gift sub that meets another sub in transit hands its cargo to the other sub's owner. It is then sent to that player's nearest outpost.
- Gift subs don't fight.

### Combat
Combat happens when a sub reaches an outpost owned by another player. It also happens when two non-gift subs of different players meet in transit. It is resolved in **4 phases**:

1. **Specialist phase:** every non-captive specialist applies its ability in order of **combat priority** (lowest first). Specialists with the same priority act at the same time. Specialists with no priority act in their own way (e.g. passive stat changes).
2. **Shield phase** (only at outposts, not between subs): the shield destroys attacking drillers one-for-one. Example: an 8-charge shield vs 5 attackers destroys all 5 and is left with 3 charge.
3. **Driller phase:** the side with more drillers wins and keeps the difference. Example: 27 vs 11 leaves the winner with 16.
   - **Tie:** the side with more surviving specialists wins.
   - **Still tied, sub vs sub:** draw. Both sides' specialists return to their owner's nearest outpost.
   - **Still tied, sub vs outpost:** the **defender (outpost) wins**.
   - An attacker with 0 drillers left still wins if the outpost has 0 drillers, 0 shield and fewer surviving specialists.
4. **Capture phase:** the loser's surviving specialists are **captured**.
   - At an outpost, they are held there.
   - Between subs, they are sent (at 1× speed) to the winner's nearest outpost.
   - Captives don't use their abilities. The captor can release them, which sends them to their owner's nearest outpost. A captive can only be loaded on a sub as part of being released.

**Results:**
- If the attacking sub wins at an outpost, the attacker **takes ownership** of the outpost.
- If a sub wins a sub-vs-sub fight, it carries on to its original target. A sub with a Pirate instead returns to its nearest friendly outpost at 4× speed.

### Mining (win resource)
- Each Mine produces **1 kg of Neptunium per day for every outpost you own**. Example: 7 outposts, 2 of them mines → 2 × 7 = 14 kg/day.
- **Drilling a mine:** you can do this at any Factory or Generator you own. The cost is drillers present *at that outpost*, which are used up:
  - 1st mine: 50
  - 2nd mine: 100
  - 3rd mine: 200
  - 4th mine: 300
  - 5th mine: 400 (+100 for each mine after that)
- Only mines **you drilled yourself** count towards the cost. Capturing mines doesn't make your next drilled mine more expensive.
- **Losing a mine:** the previous owner **loses 20% of their Neptunium**, and the mine's production timer resets. The captor gains no Neptunium; they only get the higher mining rate.
- **Every player can always see where every mine is**, even outside sonar.
- Neptunium can't be spent. It only counts towards victory and enables Funding.

### Visibility (sonar)
- Each outpost has sonar with a range of **27 travel-hours at 1.0 speed**. Specialists can change this.
- **A sub is visible** to you if:
  - it is within your sonar,
  - it is headed for one of your outposts or subs, or
  - it is yours.
  You then see its position, driller count and specialists.
- **An outpost's contents are visible** to you if it is within your sonar or it is yours. You then see its type, drillers and specialists.
- Everyone can always see **where** every outpost is. Mines are always identifiable.
- Combat outside your sonar isn't previewed. If you lose, you only learn that you lost.

### Funding
- A player may **fund** another player who has at least **20 kg less Neptunium**.
- Funding costs the funder nothing.
- The funded player gets **+50 electrical output**, and each of their factories makes **+2 drillers per cycle**.
- The funder can withdraw funding at any time. It is withdrawn automatically if the gap drops below 20 kg.

### Specialists
Specialists are special units that bend the rules. They travel on subs like drillers, and are captured instead of destroyed when they lose a fight.

**The Queen**
- Every player starts with one.
- Her outpost gets **+20 max shield**.
- Losing her means elimination, unless you have a Princess, who then becomes the Queen.
- If you take an enemy Queen (by gift or Hypnotist), she becomes your Princess.

**Hiring**
- The Queen hires her first specialist **4 hours** into the game, and one more every **18 hours** after that.
- She must be **at an outpost** to hire. The new specialist appears at her outpost.
- Each hire offers **3 choices: one Offensive, one Defensive, one Other**.
- How the offer is drawn: each category has a deck holding **3 copies of every specialist** in it. The deck is shuffled and one card is drawn per category. Picking a specialist removes that card, so duplicates become less likely.
- **Promotion:** instead of hiring, you may promote a specialist you already own to its upgraded form. It must be at an outpost.

**Specialist list** (effects from the official reference; categories from the wiki)

| Specialist | Category | Effect | Priority | Promotes to |
|---|---|---|---|---|
| Assassin | Offensive | Kills all enemy specialists in combat (including a Queen). **Hired 2 at a time.** | 7 | – |
| Infiltrator | Offensive | Drains all shield charge of an outpost it attacks. In sub-vs-sub combat, combat ends. | 5 | – |
| Lieutenant | Offensive | Destroys 5 enemy drillers in combat. Travels 1.5× speed. | 8 | General |
| Pirate | Offensive | Its sub can target an enemy **sub**, travelling 2× speed to it. After winning, returns to the nearest friendly outpost at 4× speed. | – | – |
| Thief | Offensive | Converts 15% (rounded up) of enemy drillers to your side when attacking an outpost or in sub-vs-sub combat. | 4 | – |
| Double Agent | Defensive | In sub-vs-sub combat: both subs' drillers are destroyed, the subs swap owners together with their specialists, and combat ends. | 6 | – |
| Inspector | Defensive | Fully charges the shield of a friendly outpost when arriving there, and again after every combat while present. | – | Security Chief |
| Martyr | Defensive | In combat, destroys **all subs, outposts and specialists**, including friendly ones, within a blast radius of 20% of the standard sonar range (5.4 travel-hours). Destroyed outposts stay on the map as unusable wrecks. | 1 | – |
| Revered Elder | Defensive | No other specialists take part in the combat unless both sides have a Revered Elder. | 2 | – |
| Saboteur | Defensive | In sub-vs-sub combat, redirects the enemy sub to its owner's nearest outpost. That sub can't change course afterwards. **Hired 2 at a time.** | 3 | – |
| Sentry | Defensive | While stationed at an outpost, fires every 2 h at the enemy sub in range where it does the most damage, destroying 5% of its drillers (rounded up). Range is half the outpost's sonar. | – | War Hero |
| Smuggler | Defensive | 3× speed while heading to one of its owner's outposts. | – | Tycoon |
| Diplomat | Other | Releases your captured specialists held at outposts within the Diplomat's outpost's sonar range. They return to your nearest outpost. If an outpost holding your Queen is captured within range, she escapes. | – | – |
| Foreman | Other | +4 drillers per cycle at all your factories within half the sonar range of the Foreman's outpost. | – | Engineer |
| Helmsman | Other | 2× speed. | – | – |
| Hypnotist | Other | Takes control of all captured specialists at its outpost. A converted enemy Queen becomes a Princess. | – | King |
| Intelligence Officer | Other | +25% sonar range for all your outposts. Shows the type of every outpost, even outside sonar. | – | – |
| Navigator | Other | Its sub may change destination once every 8 hours. | – | Admiral |
| Princess | Other | +50% sonar at her outpost. The nearest Princess becomes the Queen if the Queen is lost. | – | – |
| Tinkerer | Other | Adds 3 × (its outpost's max shield) to your electrical output. That outpost's shield drains 3 per hour. | – | Minister of Energy |
| **Promoted** | | | | |
| Admiral | Promoted | Global: +50% speed to all your subs that carry no specialist. Local: travels 1.5×. Doesn't stack. | – | ← Navigator |
| Engineer | Promoted | Global: after every combat you win, 25% (rounded up) of your lost drillers are repaired. Local: a further 25% where the Engineer is present. | – | ← Foreman |
| General | Promoted | Global: destroys 10 enemy drillers in every combat where you have a specialist present after the specialist phase. Local: travels 1.5×. | – | ← Lieutenant |
| King | Promoted | Global: in every combat you're in, destroys 1 enemy driller per 4 of your drillers left after the specialist phase (doesn't stack). Your outposts get −20 max shield, except the King's own outpost, which gets +20. | – | ← Hypnotist |
| Minister of Energy | Promoted | Global: +300 electrical output, but every factory makes 1 driller fewer per cycle. | – | ← Tinkerer |
| Security Chief | Promoted | Global: +10 max shield on all your outposts. Local: a further +10 at its outpost. | – | ← Inspector |
| Tycoon | Promoted | Global: +50% driller production rate (cycles happen faster). Local: +3 drillers per cycle at its factory. | – | ← Smuggler |
| War Hero | Promoted | Destroys 20 enemy drillers in combat. | 8 | ← Sentry |

Notes on sources:
- The wiki differs from the official reference in some places. It gives Foreman +6 local only, Navigator unlimited re-routing, King 1 per 3, and lower priorities for Assassin, Double Agent, Infiltrator, Lieutenant and War Hero. We use the official values.
- The official page says "War Hero → promotes to Sentry". This looks like a typo, since Sentry can be hired and War Hero can't, so we use Sentry → War Hero.
- Speed bonuses from several specialists on one sub: we use the fastest one rather than multiplying them (house rule, tunable).

### Time and orders
- The simulation advances in **ticks of 10 minutes**. Orders can be given at any time but take effect on the next tick. Events in the same tick are resolved in exact arrival order.
- **Time machine:** players can:
  - scrub back through what they have seen,
  - preview a simulated future based only on what they can currently see, and
  - **schedule orders** (launches, hires, drills, etc.) at a future time.
- Real games last 7–10 days of real time. All durations in this document are **game-hours**. The clone should have a global **time-scale constant**, e.g. 1 game-hour = 1 real minute for quick games.

### Diplomacy
- In-game chat: public, and private with any group of players.
- No formal alliance system. Cooperation happens through chat, gifts and funding.

---

## Tech stack
Goal: anyone can `git clone` and run `docker compose up`, without signing up for any external service.

This is a summary. For details see [docs/architecture.md](docs/architecture.md), [docs/auth.md](docs/auth.md) and the [decision log](docs/decisions.md).

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere (npm workspaces monorepo) |
| `packages/engine` | Pure, deterministic rules engine shared by server and client. No `Date.now()`, seeded random generator, integer maths. Tested with Vitest |
| Client | Angular 22. The map is rendered on Canvas (or PixiJS if needed) |
| Server | Node + Fastify (serves the API and the built Angular app) |
| Realtime | Socket.IO attached to Fastify's HTTP server |
| Database | Postgres via postgres.js (`porsager/postgres`). Migrations are plain `.sql` files run in order at startup |
| Auth | Built in: username + password, Postgres sessions, httpOnly cookie (see below) |
| Deploy | `docker compose up` → `db` (postgres) + `app` (multi-stage Node image) |

### Architecture principles
- **The server is authoritative.** It filters what each player can see (fog of war) before sending anything. The client never gets the full game state.
- **Event-driven simulation.** A priority queue of the next events (arrivals, production cycles, hires) is processed in order, rounded to 10-minute ticks. A global time scale lets quick games run faster.
- **Orders are an event log, plus snapshots.** Game state = starting seed + all orders, replayed. Scheduled orders are ordinary orders with a future timestamp.
- **Restart-safe scheduler.** Each game stores its `next_event_at` in Postgres, and a worker loop wakes games when it is due.
- **The time machine runs the shared engine in the browser**, using only the state that player can see.

### Auth (keep it simple, no third parties)
- `users(id, username unique, password_hash, created_at)`
- `sessions(token_hash, user_id, expires_at)`
- Passwords are hashed with Node's built-in `crypto.scrypt` and compared with `crypto.timingSafeEqual`.
- Session token: `crypto.randomBytes(32)`. Only its SHA-256 hash is stored. It is sent as an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production) and lasts 30 days.
- Socket.IO authenticates on the handshake by reading the same cookie.
- The Angular dev server proxies `/api` and `/socket.io` so everything stays same-origin; no CORS needed.
- Login gets a simple in-memory rate limit.
- No email, so no password reset in v1; an admin can reset passwords through the CLI.
- Keycloak is not used, because it is heavy for this project. We can revisit it if SSO, social login or MFA are ever needed.

---

### Open questions for our clone
Still open:
- Which specialists to include in v1? Suggestion: Queen, Princess, Helmsman, Lieutenant/General, Inspector/Security Chief, Foreman, Thief, Navigator, Intelligence Officer. Add the complex ones (Martyr, Double Agent, Pirate, Hypnotist, Revered Elder) later.
- Domination mode: include in v1, and what outpost target per player count?

Answered (details in `docs/`):
- **Shield ratio:** 1/3 of outposts have max 20, the rest max 10 (decided by the user; the developer quote of 2/3 is not used).
- **Time scale:** both. Per-game speed presets: real time, 60× and 240× (`GAME_SPEEDS`).
- **Shield after capture:** an attacker only wins once the shield is drained, so a captured outpost starts at 0 charge and recharges from there.
- **Distance scale:** map units with `SUB_SPEED` = 1 unit per game minute. Every map is 4000 units square, so neighbouring outposts are about 6.3 travel-hours apart at 10 players and 9.5 h at 2. Sonar is 1620 units (27 h). See `docs/engine.md` and `npm run map:stats -w @subterfuge/engine`.

For what to build next, see [docs/roadmap.md](docs/roadmap.md).
