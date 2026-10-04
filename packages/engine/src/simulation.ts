import { resolveOutpostCombat, resolveSubCombat } from './combat.js';
import {
  FACTORY_CYCLE,
  MINE_LOSS_PENALTY,
  NEPTUNIUM_TO_WIN,
  NEPTUNIUM_UNIT,
  QUEEN_SHIELD_BONUS,
  SUB_SPEED,
  TICK,
} from './constants.js';
import { electricalOutput, factoryCycleOutput, mineDrillCost } from './economy.js';
import { distance } from './geometry.js';
import { chargeShield, progressForCharge, shieldCharge } from './shield.js';
import type {
  CombatDetails,
  GameEvent,
  GameState,
  GameTime,
  LaunchOrder,
  Order,
  Outpost,
  OutpostId,
  PlayerId,
  Point,
  Specialist,
  Sub,
} from './types.js';

/*
 * Simulation rules and the simplifications we made (see goal.md for the
 * official rules):
 *
 * - Time advances in fixed TICKs. An order runs in the tick `t` with
 *   `t - TICK < order.at <= t` (orders should already be tick-aligned). The
 *   state at time T already includes everything that happened at T, so orders
 *   with `at <= state.time` are ignored by `advance`.
 * - Travel time is rounded up to whole ticks; subs move linearly over it.
 * - Sub-vs-sub: captured specialists are moved straight to the winner's
 *   nearest outpost (no slow trip there). In a draw, specialists go straight
 *   home. If a player has no outpost to send them to, the specialists are
 *   lost (a lost Queen eliminates her owner).
 * - A gift sub meeting another player's sub hands its drillers and
 *   specialists to that sub, which carries on (the official game sends a new
 *   sub home instead).
 * - Queens can't be gifted (rejected), since Princess promotion isn't built.
 * - Disabling a shield drops it to 0 and it doesn't charge while off;
 *   re-enabling recharges from 0. A captured outpost's shield is switched
 *   back on for the new owner. (The original forum/rulebook evidence is thin:
 *   disabling exists for handing outposts over, which only works if the
 *   charge goes to 0.) Dormant (unowned) outposts don't charge their shields
 *   and never resist capture.
 * - Arrivals in the same tick resolve in launch order (sub id).
 * - Production is simultaneous: at each FACTORY_CYCLE every factory of a
 *   player sees the same pre-cycle driller total. If the remaining room under
 *   the electrical cap can't fit every factory's full output, the room is
 *   split evenly and the remainder goes one each to factories in ascending
 *   outpost-id order (o-2 before o-10). The cap is never exceeded.
 * - Mines accrue Neptunium continuously, every tick, instead of paying out
 *   once per day. So the official "production timer resets when a mine is
 *   lost" has no equivalent: the previous owner keeps what already accrued,
 *   and the captor starts accruing from the next tick. The 20% loss is
 *   floored on stored units (1/1440 kg precision).
 * - Gifts must target another player's outpost (validated). A gift that
 *   still reaches a dormant or own outpost behaves like a normal sub.
 * - Orders from eliminated players are skipped silently (no orderRejected
 *   event); the server cancels them too.
 * - Resigning eliminates the player like a lost Queen (Neptunium → 0, mines
 *   stop). Their specialists stay where they are; their outposts remain and
 *   keep producing and charging, as for any eliminated player.
 * - Auto-resign after INACTIVITY_AUTO_RESIGN is not implemented: inactivity
 *   is real-time based and needs server-side activity tracking.
 * - If every remaining player is eliminated in the same tick, the game ends
 *   in a draw (`endedAt` set, `winner` null, `gameDrawn` event).
 */

export interface AdvanceResult {
  state: GameState;
  events: GameEvent[];
}

// --- Small lookups ---------------------------------------------------------

function outpostOf(state: GameState, id: OutpostId): Outpost | undefined {
  return state.outposts.find((o) => o.id === id);
}

function subNumber(id: string): number {
  return Number(id.slice(id.lastIndexOf('-') + 1));
}

/** Orders ids by numeric suffix (o-2 before o-10); falls back to string order. */
function compareIds(a: string, b: string): number {
  const na = subNumber(a);
  const nb = subNumber(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function specialistsAt(state: GameState, where: { outpost: OutpostId } | { sub: string }): Specialist[] {
  return state.specialists.filter((s) =>
    'outpost' in where
      ? 'outpost' in s.location && s.location.outpost === where.outpost
      : 'sub' in s.location && s.location.sub === where.sub,
  );
}

/** Specialists that act in combat: at the location, owned by `owner`, not captive. */
function activeSpecialists(state: GameState, where: { outpost: OutpostId } | { sub: string }, owner: PlayerId) {
  return specialistsAt(state, where).filter((s) => s.owner === owner && s.captiveOf === null);
}

/** Owned outpost nearest to a point, or undefined if the player owns none. */
export function nearestOwnedOutpost(state: GameState, player: PlayerId, point: Point): Outpost | undefined {
  let best: Outpost | undefined;
  let bestDist = Infinity;
  for (const o of state.outposts) {
    if (o.owner !== player) continue;
    const d = distance(o.position, point);
    if (d < bestDist) {
      best = o;
      bestDist = d;
    }
  }
  return best;
}

// --- Movement --------------------------------------------------------------

/** Minutes to travel between two outposts at 1.0 speed, rounded up to whole ticks (at least one). */
export function travelTime(state: GameState, from: OutpostId, to: OutpostId): GameTime {
  const a = outpostOf(state, from);
  const b = outpostOf(state, to);
  if (!a || !b) throw new Error(`travelTime: unknown outpost ${a ? to : from}`);
  return Math.max(TICK, Math.ceil(distance(a.position, b.position) / SUB_SPEED / TICK) * TICK);
}

/** Where a sub is at `time` (clamped to its route). Used by visibility and the client to draw subs. */
export function subPosition(state: GameState, sub: Sub, time: GameTime): Point {
  const a = outpostOf(state, sub.from);
  const b = outpostOf(state, sub.to);
  if (!a || !b) throw new Error(`subPosition: unknown outpost on ${sub.id}`);
  const span = sub.arrivesAt - sub.launchedAt;
  const f = span <= 0 ? 1 : Math.min(1, Math.max(0, (time - sub.launchedAt) / span));
  return { x: a.position.x + (b.position.x - a.position.x) * f, y: a.position.y + (b.position.y - a.position.y) * f };
}

// --- Orders ----------------------------------------------------------------

/**
 * Checks an order against the current state without executing it. Returns a
 * reason if invalid, else `null`. Does not check `order.at` (the caller
 * decides when orders may be scheduled).
 */
export function validateOrder(state: GameState, order: Order): string | null {
  if (state.endedAt !== null) return 'The game is over.';
  const player = state.players.find((p) => p.id === order.player);
  if (!player) return 'Unknown player.';
  if (player.eliminated) return 'You have been eliminated.';

  switch (order.kind) {
    case 'launch':
      return validateLaunch(state, order);
    case 'drillMine': {
      const outpost = outpostOf(state, order.outpost);
      if (!outpost) return 'Unknown outpost.';
      if (outpost.owner !== order.player) return 'You do not own that outpost.';
      if (outpost.type === 'mine') return 'That outpost is already a mine.';
      const cost = mineDrillCost(player.minesDrilled);
      if (outpost.drillers < cost) return `Drilling a mine here needs ${cost} drillers.`;
      return null;
    }
    case 'setShield': {
      const outpost = outpostOf(state, order.outpost);
      if (!outpost) return 'Unknown outpost.';
      if (outpost.owner !== order.player) return 'You do not own that outpost.';
      return null;
    }
    case 'resign':
      return null;
    case 'voteEnd':
      return null;
  }
}

function validateLaunch(state: GameState, order: LaunchOrder): string | null {
  const from = outpostOf(state, order.from);
  const to = outpostOf(state, order.to);
  if (!from || !to) return 'Unknown outpost.';
  if (from.id === to.id) return 'A sub must go to a different outpost.';
  if (from.owner !== order.player) return 'You do not own the launch outpost.';
  if (order.isGift && (to.owner === null || to.owner === order.player)) {
    return "Gifts must target another player's outpost.";
  }
  if (!Number.isInteger(order.drillers) || order.drillers < 0) return 'Invalid driller count.';
  if (order.drillers > from.drillers) return 'Not enough drillers at the launch outpost.';
  if (new Set(order.specialists).size !== order.specialists.length) return 'Duplicate specialists.';
  for (const id of order.specialists) {
    const spec = state.specialists.find((s) => s.id === id);
    if (!spec || spec.owner !== order.player || spec.captiveOf !== null) return 'Invalid specialist.';
    if (!('outpost' in spec.location) || spec.location.outpost !== from.id) {
      return 'Specialist is not at the launch outpost.';
    }
    if (order.isGift && spec.kind === 'queen') return 'The Queen cannot be gifted.';
  }
  if (order.drillers === 0 && order.specialists.length === 0) return 'A sub must carry drillers or specialists.';
  return null;
}

function executeOrder(state: GameState, order: Order, events: GameEvent[]): void {
  // Eliminated players can't act; their leftover orders vanish silently.
  if (state.players.find((p) => p.id === order.player)?.eliminated) return;
  const reason = validateOrder(state, order);
  if (reason) {
    events.push({ kind: 'orderRejected', at: state.time, order, reason });
    return;
  }
  switch (order.kind) {
    case 'launch': {
      const from = outpostOf(state, order.from)!;
      const id = `sub-${state.nextId++}`;
      from.drillers -= order.drillers;
      state.subs.push({
        id,
        owner: order.player,
        from: order.from,
        to: order.to,
        drillers: order.drillers,
        specialists: [...order.specialists],
        launchedAt: state.time,
        arrivesAt: state.time + travelTime(state, order.from, order.to),
        isGift: order.isGift ?? false,
      });
      for (const s of state.specialists) if (order.specialists.includes(s.id)) s.location = { sub: id };
      events.push({ kind: 'subLaunched', at: state.time, sub: id, owner: order.player, from: order.from, to: order.to });
      return;
    }
    case 'drillMine': {
      const outpost = outpostOf(state, order.outpost)!;
      const player = state.players.find((p) => p.id === order.player)!;
      outpost.drillers -= mineDrillCost(player.minesDrilled);
      outpost.type = 'mine';
      player.minesDrilled++;
      events.push({ kind: 'mineDrilled', at: state.time, outpost: outpost.id, player: player.id });
      return;
    }
    case 'setShield': {
      // Disabling drops the charge to 0 and stops charging; re-enabling
      // recharges from 0. That's what makes disabling useful for handing an
      // outpost over (goal.md → Shields).
      const outpost = outpostOf(state, order.outpost)!;
      outpost.shieldEnabled = order.enabled;
      if (!order.enabled) outpost.shieldProgress = 0;
      return;
    }
    case 'resign':
      eliminate(state, order.player, events, 'resigned');
      return;
    case 'voteEnd': {
      const has = state.endVotes.includes(order.player);
      if (order.agree === has) return; // no change
      state.endVotes = order.agree ? [...state.endVotes, order.player] : state.endVotes.filter((p) => p !== order.player);
      events.push({ kind: 'endVote', at: state.time, player: order.player, agree: order.agree });
      return;
    }
  }
}

// --- Specialists & elimination --------------------------------------------

function eliminate(
  state: GameState,
  player: PlayerId,
  events: GameEvent[],
  reason: 'queenCaptured' | 'resigned' = 'queenCaptured',
): void {
  const p = state.players.find((x) => x.id === player);
  if (!p || p.eliminated) return;
  p.eliminated = true;
  p.neptunium = 0;
  events.push({ kind: 'playerEliminated', at: state.time, player, reason });
}

/** Takes specialists prisoner at an outpost. Captured Queens eliminate their owner. */
function capture(state: GameState, specs: Specialist[], captor: PlayerId, outpost: OutpostId, events: GameEvent[]) {
  for (const s of specs) {
    s.location = { outpost };
    s.captiveOf = captor;
    if (s.kind === 'queen') eliminate(state, s.owner, events);
  }
}

/** Removes specialists from the game (no place to send them). Lost Queens eliminate their owner. */
function lose(state: GameState, specs: Specialist[], events: GameEvent[]) {
  const ids = new Set(specs.map((s) => s.id));
  state.specialists = state.specialists.filter((s) => !ids.has(s.id));
  for (const s of specs) if (s.kind === 'queen') eliminate(state, s.owner, events);
}

/** Sends specialists straight to their owner's nearest outpost (sub-vs-sub draw). */
function sendHome(state: GameState, specs: Specialist[], at: Point, events: GameEvent[]) {
  const homeless: Specialist[] = [];
  for (const s of specs) {
    const home = nearestOwnedOutpost(state, s.owner, at);
    if (home) s.location = { outpost: home.id };
    else homeless.push(s);
  }
  lose(state, homeless, events);
}

function removeSub(state: GameState, id: string) {
  state.subs = state.subs.filter((s) => s.id !== id);
}

// --- Sub-vs-sub encounters -------------------------------------------------

/** Time two subs on the same lane in opposite directions cross, or undefined. */
function crossingTime(a: Sub, b: Sub): number | undefined {
  if (a.from !== b.to || a.to !== b.from) return undefined;
  const ta = a.arrivesAt - a.launchedAt;
  const tb = b.arrivesAt - b.launchedAt;
  // a's progress from a.from + b's progress from b.from = 1 at the crossing.
  const c = (1 + a.launchedAt / ta + b.launchedAt / tb) / (1 / ta + 1 / tb);
  const eps = 1e-9;
  if (c < Math.max(a.launchedAt, b.launchedAt) - eps) return undefined;
  if (c > Math.min(a.arrivesAt, b.arrivesAt) + eps) return undefined;
  return c;
}

function resolveEncounters(state: GameState, events: GameEvent[]): void {
  const t = state.time;
  const candidates: { a: Sub; b: Sub; c: number }[] = [];
  // Only subs on the same lane (either direction) can meet, so compare
  // within lanes. Sorting first keeps pairs as (lower id, higher id).
  const lanes = new Map<string, Sub[]>();
  for (const sub of [...state.subs].sort((x, y) => subNumber(x.id) - subNumber(y.id))) {
    const key = sub.from < sub.to ? `${sub.from}|${sub.to}` : `${sub.to}|${sub.from}`;
    const lane = lanes.get(key);
    if (lane) lane.push(sub);
    else lanes.set(key, [sub]);
  }
  for (const subs of lanes.values()) {
    for (let i = 0; i < subs.length; i++) {
      for (let j = i + 1; j < subs.length; j++) {
        const a = subs[i]!;
        const b = subs[j]!;
        if (a.owner === b.owner) continue;
        const c = crossingTime(a, b);
        if (c === undefined) continue;
        // Resolve in the first tick at or after the crossing.
        if (Math.ceil((c - 1e-9) / TICK) * TICK !== t) continue;
        candidates.push({ a, b, c });
      }
    }
  }
  candidates.sort((x, y) => x.c - y.c || subNumber(x.a.id) - subNumber(y.a.id) || subNumber(x.b.id) - subNumber(y.b.id));

  for (const { a, b, c } of candidates) {
    // An earlier encounter this tick may have removed or emptied either sub.
    if (!state.subs.includes(a) || !state.subs.includes(b)) continue;
    const where = subPosition(state, a, c);
    if (a.isGift && b.isGift) continue;
    if (a.isGift || b.isGift) {
      const [gift, other] = a.isGift ? [a, b] : [b, a];
      other.drillers += gift.drillers;
      for (const s of specialistsAt(state, { sub: gift.id })) {
        s.owner = other.owner;
        s.location = { sub: other.id };
        other.specialists.push(s.id);
      }
      removeSub(state, gift.id);
      continue;
    }

    const aSpecs = activeSpecialists(state, { sub: a.id }, a.owner);
    const bSpecs = activeSpecialists(state, { sub: b.id }, b.owner);
    const result = resolveSubCombat(
      { drillers: a.drillers, specialists: aSpecs.length },
      { drillers: b.drillers, specialists: bSpecs.length },
    );
    const details: CombatDetails = {
      sides: [
        { player: a.owner, drillersBefore: a.drillers, drillersAfter: result.a, specialists: aSpecs.length },
        { player: b.owner, drillersBefore: b.drillers, drillersAfter: result.b, specialists: bSpecs.length },
      ],
    };
    a.drillers = result.a;
    b.drillers = result.b;
    const winnerId = result.winner === 'a' ? a.owner : result.winner === 'b' ? b.owner : null;
    events.push({ kind: 'combat', at: t, subs: [a.id, b.id], players: [a.owner, b.owner], winner: winnerId, details });

    if (result.winner === 'draw') {
      sendHome(state, [...aSpecs, ...bSpecs], where, events);
      removeSub(state, a.id);
      removeSub(state, b.id);
      continue;
    }
    const [winner, loser, loserSpecs] = result.winner === 'a' ? [a, b, bSpecs] : [b, a, aSpecs];
    removeSub(state, loser.id);
    const prison = nearestOwnedOutpost(state, winner.owner, where);
    if (prison) capture(state, loserSpecs, winner.owner, prison.id, events);
    else sendHome(state, loserSpecs, where, events);
    if (winner.drillers === 0 && specialistsAt(state, { sub: winner.id }).length === 0) removeSub(state, winner.id);
  }
}

// --- Arrivals --------------------------------------------------------------

function resolveArrivals(state: GameState, events: GameEvent[]): void {
  const t = state.time;
  const arriving = state.subs
    .filter((s) => s.arrivesAt <= t)
    .sort((x, y) => subNumber(x.id) - subNumber(y.id));

  for (const sub of arriving) {
    const outpost = outpostOf(state, sub.to)!;
    const cargo = specialistsAt(state, { sub: sub.id });
    removeSub(state, sub.id);
    events.push({ kind: 'subArrived', at: t, sub: sub.id, owner: sub.owner, outpost: outpost.id });

    // Gifts to dormant or own outposts are rejected when launched, and
    // outposts never become dormant again, so a gift reaching one is
    // unreachable today; if it happens it behaves like a normal sub.
    if (outpost.owner === sub.owner) {
      outpost.drillers += sub.drillers;
      for (const s of cargo) s.location = { outpost: outpost.id };
      continue;
    }

    if (outpost.owner === null) {
      // Dormant outposts are taken without resistance.
      outpost.owner = sub.owner;
      outpost.shieldEnabled = true;
      outpost.drillers += sub.drillers;
      for (const s of cargo) s.location = { outpost: outpost.id };
      events.push({ kind: 'outpostCaptured', at: t, outpost: outpost.id, from: null, to: sub.owner });
      continue;
    }

    if (sub.isGift) {
      outpost.drillers += sub.drillers;
      for (const s of cargo) {
        s.owner = outpost.owner;
        s.location = { outpost: outpost.id };
      }
      continue;
    }

    attackOutpost(state, sub, outpost, cargo, events);
  }
}

function attackOutpost(state: GameState, sub: Sub, outpost: Outpost, cargo: Specialist[], events: GameEvent[]) {
  const t = state.time;
  const defender = outpost.owner!;
  const attackers = cargo.filter((s) => s.captiveOf === null);
  const defenders = activeSpecialists(state, { outpost: outpost.id }, defender);
  const shield = outpost.shieldEnabled ? shieldCharge(outpost.shieldProgress) : 0;

  const result = resolveOutpostCombat({
    attackerDrillers: sub.drillers,
    attackerSpecialists: attackers.length,
    defenderDrillers: outpost.drillers,
    defenderShield: shield,
    defenderSpecialists: defenders.length,
  });
  // Drain only what the shield absorbed, keeping fractional progress.
  outpost.shieldProgress = Math.max(0, outpost.shieldProgress - progressForCharge(shield - result.defenderShield));

  const winnerId = result.winner === 'attacker' ? sub.owner : defender;
  const details: CombatDetails = {
    sides: [
      { player: sub.owner, drillersBefore: sub.drillers, drillersAfter: result.attackerDrillers, specialists: attackers.length },
      { player: defender, drillersBefore: outpost.drillers, drillersAfter: result.defenderDrillers, specialists: defenders.length },
    ],
    shieldBefore: shield,
    shieldAfter: result.defenderShield,
  };
  events.push({ kind: 'combat', at: t, outpost: outpost.id, subs: [sub.id], players: [sub.owner, defender], winner: winnerId, details });

  if (result.winner === 'defender') {
    outpost.drillers = result.defenderDrillers;
    capture(state, cargo, defender, outpost.id, events);
    return;
  }

  outpost.owner = sub.owner;
  // The shield setting belongs to the owner: a captured outpost's shield is on.
  outpost.shieldEnabled = true;
  outpost.drillers = result.attackerDrillers;
  for (const s of cargo) s.location = { outpost: outpost.id };
  // Prisoners held here change hands: the attacker's own are freed.
  for (const s of specialistsAt(state, { outpost: outpost.id })) {
    if (s.captiveOf === null) continue;
    s.captiveOf = s.owner === sub.owner ? null : sub.owner;
  }
  if (outpost.type === 'mine') {
    // 20% of stored units, floored (1 unit = 1/1440 kg, so effectively exact).
    const prev = state.players.find((p) => p.id === defender)!;
    prev.neptunium -= Math.floor(prev.neptunium * MINE_LOSS_PENALTY);
  }
  events.push({ kind: 'outpostCaptured', at: t, outpost: outpost.id, from: defender, to: sub.owner });
  capture(state, defenders, sub.owner, outpost.id, events);
}

// --- Economy ---------------------------------------------------------------

/**
 * One production cycle, simultaneous for all of a player's factories (see
 * the deviation notes at the top). The result doesn't depend on the order of
 * `state.outposts`.
 */
function produce(state: GameState): void {
  for (const player of state.players) {
    const owned = state.outposts.filter((o) => o.owner === player.id);
    const factories = owned
      .filter((o) => o.type === 'factory')
      .sort((a, b) => compareIds(a.id, b.id));
    if (factories.length === 0) continue;
    const total =
      owned.reduce((n, o) => n + o.drillers, 0) +
      state.subs.filter((s) => s.owner === player.id).reduce((n, s) => n + s.drillers, 0);
    const cap = electricalOutput({ generators: owned.filter((o) => o.type === 'generator').length });
    const full = factoryCycleOutput({ totalDrillers: 0, electricalOutput: Infinity });
    const room = Math.max(0, cap - total);
    if (room >= full * factories.length) {
      for (const f of factories) f.drillers += full;
      continue;
    }
    const share = Math.floor(room / factories.length);
    const extra = room % factories.length;
    factories.forEach((f, i) => (f.drillers += share + (i < extra ? 1 : 0)));
  }
}

function chargeShieldsAndMine(state: GameState): void {
  // Outposts holding their owner's free Queen (keyed "outpost|owner").
  const queenAt = new Set<string>();
  for (const s of state.specialists) {
    if (s.kind === 'queen' && s.captiveOf === null && 'outpost' in s.location) queenAt.add(`${s.location.outpost}|${s.owner}`);
  }
  const owned = new Map<PlayerId, { outposts: number; mines: number }>();
  for (const outpost of state.outposts) {
    if (outpost.owner === null) continue;
    // A disabled shield stays at 0 (see setShield).
    if (outpost.shieldEnabled) {
      const max = outpost.shieldMax + (queenAt.has(`${outpost.id}|${outpost.owner}`) ? QUEEN_SHIELD_BONUS : 0);
      outpost.shieldProgress = chargeShield(outpost.shieldProgress, max, TICK);
    }
    const count = owned.get(outpost.owner) ?? { outposts: 0, mines: 0 };
    count.outposts++;
    if (outpost.type === 'mine') count.mines++;
    owned.set(outpost.owner, count);
  }
  for (const player of state.players) {
    if (player.eliminated) continue;
    const count = owned.get(player.id);
    if (count) player.neptunium += count.mines * count.outposts * TICK;
  }
}

function checkWin(state: GameState, events: GameEvent[]): void {
  const alive = state.players.filter((p) => !p.eliminated);
  const rich = alive.find((p) => p.neptunium >= NEPTUNIUM_TO_WIN * NEPTUNIUM_UNIT);
  if (rich) {
    state.winner = rich.id;
    state.endedAt = state.time;
    events.push({ kind: 'gameWon', at: state.time, player: rich.id, reason: 'neptunium' });
  } else if (alive.length === 1 && state.players.length > 1) {
    state.winner = alive[0]!.id;
    state.endedAt = state.time;
    events.push({ kind: 'gameWon', at: state.time, player: alive[0]!.id, reason: 'lastStanding' });
  } else if (alive.length === 0 && state.players.length > 1) {
    state.endedAt = state.time;
    events.push({ kind: 'gameDrawn', at: state.time, reason: 'eliminated' });
  } else if (alive.length > 0 && alive.every((p) => state.endVotes.includes(p.id))) {
    // Everyone still in the game agreed to end it: no winner.
    state.endedAt = state.time;
    events.push({ kind: 'gameDrawn', at: state.time, reason: 'agreed' });
  }
}

// --- Main loop -------------------------------------------------------------

/**
 * Simulates from `state.time` up to and including tick `until` (a multiple of
 * `TICK`), executing `orders` whose `at` falls in that range. Pure: never
 * mutates its inputs.
 *
 * Per tick, in this order:
 *   1. execute orders scheduled for this tick (in array order)
 *   2. move subs; resolve sub-vs-sub encounters, then arrivals (by sub id)
 *   3. factory production (every `FACTORY_CYCLE`, capped by electrical output)
 *   4. shield charging and mining
 *   5. elimination and win/draw checks (the state stops changing once
 *      `endedAt` is set; only `time` keeps moving)
 */
export function advance(state: GameState, orders: readonly Order[], until: GameTime): AdvanceResult {
  const s = structuredClone(state);
  // Stable sort keeps array order for orders in the same tick; a cursor then
  // walks the list once instead of scanning every order on every tick.
  const pending = structuredClone(orders.filter((o) => o.at > s.time && o.at <= until)).sort((a, b) => a.at - b.at);
  let next = 0;
  const events: GameEvent[] = [];

  while (s.time + TICK <= until) {
    s.time += TICK;
    if (s.endedAt !== null) continue;
    while (next < pending.length && pending[next]!.at <= s.time) executeOrder(s, pending[next++]!, events);
    resolveEncounters(s, events);
    resolveArrivals(s, events);
    if (s.time % FACTORY_CYCLE === 0) produce(s);
    chargeShieldsAndMine(s);
    checkWin(s, events);
  }
  return { state: s, events };
}
