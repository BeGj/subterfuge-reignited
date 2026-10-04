import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  OUTPOSTS_PER_PLAYER,
  STARTING_DRILLERS,
  STARTING_OUTPOSTS,
  STRONG_SHIELD_MAX,
  STRONG_SHIELD_SHARE,
  WEAK_SHIELD_MAX,
} from './constants.js';
import { outpostNames } from './names.js';
import { createRandom, type Random } from './random.js';
import type { GameState, Outpost, OutpostType, Player, PlayerId, Point, Specialist } from './types.js';

/*
 * Deviations from the official setup (goal.md → Game setup):
 *
 * - Starting outposts: officially each player gets "the 5 outposts nearest
 *   their centre". We draft them in snake order (1→N, then N→1), each pick
 *   taking the unclaimed outpost nearest the picker's centre. When centres
 *   are far enough apart this yields exactly the 5 nearest; it only differs
 *   when players' nearest outposts overlap, which the official text doesn't
 *   say how to resolve. The Queen always goes on a player's first pick.
 * - We generate MAP_CANDIDATES (150) candidate maps instead of 500, to keep
 *   generation fast (~120 ms for 10 players).
 * - Balance is approximated: every dormant outpost is assigned to the player
 *   whose starting outpost is nearest (straight-line distance), instead of
 *   simulating "every player sends 1 driller to every outpost".
 * - Map geometry trades two invariants against each other; see
 *   SPACING_SCALE_EXPONENT below.
 */

export interface MapPlayer {
  id: PlayerId;
  name: string;
}

export interface GenerateMapOptions {
  seed: number;
  /** In seat order. 2–10 players. */
  players: MapPlayer[];
}

/**
 * Average spacing between outposts in map units for a full 10-player game.
 * With the repulsion below, the typical nearest-neighbour distance ends up
 * around 0.9× this, i.e. roughly 6 hours of travel at 1.0 speed. Smaller
 * games spread out further (see SPACING_SCALE_EXPONENT): about 9.5 hours at
 * 2 players.
 */
export const OUTPOST_SPACING = 400;

/**
 * How much the map grows when there are fewer players than `MAX_PLAYERS`.
 *
 * At 0.5 the map *area* is held constant: every game is `mapSize(10)` units
 * square and extra players just crowd it with more outposts.
 *
 * Why not constant density (the obvious reading of "keep outpost density the
 * same", which shrinks the map as players are removed)? Because sonar range is
 * an absolute distance, so a small map has no fog of war: at 2 players a
 * player's five outposts' sonar covered 99 % of the map. Measured with
 * `npm run map:stats`:
 *
 *   exponent   2p neighbour travel   2p map seen   10p neighbour travel
 *   0          6.7 h                 99 %          6.3 h
 *   0.5        9.5 h                 59-76 %       6.3 h
 *   0.75       12.1 h                36-60 %       6.3 h
 *
 * 0.5 gives a 2-player game real fog for a 2.8-hour tax on travel and changes
 * nothing for 4 players and up. Past that, travel gets long enough to make a
 * real-time game feel slow.
 *
 * At 10 players the geometry is identical for every value of this constant
 * (`(10/10) ** e === 1`), so the dial only ever trades small-game travel time
 * against small-game fog. Tunable — see docs/engine.md.
 */
export const SPACING_SCALE_EXPONENT = 0.5;
/** Candidate maps generated per game; the most balanced one is kept (the original uses 500). */
export const MAP_CANDIDATES = 150;
/** Share of outposts that are generators is drawn from this range. */
export const GENERATOR_SHARE_RANGE = [0.3, 0.6] as const;

/**
 * Side length of the (square) map for `n` players. Constant density at
 * exponent 0; constant area at exponent 0.5.
 */
export function mapSize(n: number): number {
  const total = n * OUTPOSTS_PER_PLAYER;
  const scale = (MAX_PLAYERS / n) ** SPACING_SCALE_EXPONENT;
  // Rounded rather than ceiled: at exponent 0.5 the product is exactly
  // OUTPOST_SPACING * sqrt(MAX_PLAYERS * OUTPOSTS_PER_PLAYER) for every n,
  // and floating point lands a hair either side of it.
  return Math.round(Math.sqrt(total) * OUTPOST_SPACING * scale);
}

const RELAX_ITERATIONS = 30;
/** Player centres stay this fraction of the map size away from the edges. */
const CENTRE_MARGIN = 0.12;
/** Outposts stay at least this far from the map edges. */
const EDGE_MARGIN = OUTPOST_SPACING / 2;

/**
 * Builds the starting state of a new game (goal.md → Game setup):
 * N×10 outposts, each player owning the 5 nearest their centre (Queen on the
 * closest, 40 drillers on the other 4), generator share 30–60%, shield maxes
 * dealt round-robin from a shared deck, best-balanced of many candidate maps.
 *
 * Deterministic: the same options always give the same state.
 */
export function generateMap(options: GenerateMapOptions): GameState {
  const { players, seed } = options;
  const n = players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`A game needs ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${n}`);
  }
  if (new Set(players.map((p) => p.id)).size !== n) throw new Error('Player ids must be unique');

  const rng = createRandom(seed);
  const total = n * OUTPOSTS_PER_PLAYER;
  const size = mapSize(n);

  let best: Candidate | undefined;
  for (let i = 0; i < MAP_CANDIDATES; i++) {
    const candidate = createCandidate(rng, n, total, size);
    if (!best || candidate.imbalance < best.imbalance) best = candidate;
  }
  return buildState(best!, options, rng, size);
}

interface Candidate {
  positions: Point[];
  /** owned[p] = outpost indices owned by player p; owned[p][0] holds the Queen. */
  owned: number[][];
  types: OutpostType[];
  shieldMax: number[];
  imbalance: number;
}

function createCandidate(rng: Random, n: number, total: number, size: number): Candidate {
  // Centres repel within ~1.2× their ideal spacing; a whole-map radius would
  // push everyone to the edges and leave the middle player surrounded.
  const centreMargin = size * CENTRE_MARGIN;
  const centreRadius = ((size - 2 * centreMargin) / Math.sqrt(n)) * 1.2;
  const centres = relax(randomPoints(rng, n, size, centreMargin), size, centreMargin, centreRadius);
  // Integer coordinates keep the state compact and platform-independent, and
  // the balance check below then scores exactly the map we would return.
  const positions = relax(randomPoints(rng, total, size, EDGE_MARGIN), size, EDGE_MARGIN, OUTPOST_SPACING * 1.2).map(
    (p) => ({ x: Math.round(p.x), y: Math.round(p.y) }),
  );

  // Players claim their 5 starting outposts in snake order (1→N, N→1, ...), each
  // taking the unclaimed outpost nearest their centre, so no one is favoured.
  const claimed = new Set<number>();
  const owned: number[][] = centres.map(() => []);
  for (let round = 0; round < STARTING_OUTPOSTS; round++) {
    for (let k = 0; k < n; k++) {
      const p = round % 2 === 0 ? k : n - 1 - k;
      const pick = nearestUnclaimed(positions, centres[p]!, claimed);
      claimed.add(pick);
      owned[p]!.push(pick);
    }
  }

  // Types and shields are dealt from shuffled decks, round-robin from each
  // centre outward, so every player gets a similar mix nearby.
  const share = GENERATOR_SHARE_RANGE[0] + rng.next() * (GENERATOR_SHARE_RANGE[1] - GENERATOR_SHARE_RANGE[0]);
  const generators = Math.round(total * share);
  const typeDeck = rng.shuffle(
    Array.from({ length: total }, (_, i): OutpostType => (i < generators ? 'generator' : 'factory')),
  );
  const strong = Math.round(total * STRONG_SHIELD_SHARE);
  const shieldDeck = rng.shuffle(
    Array.from({ length: total }, (_, i) => (i < strong ? STRONG_SHIELD_MAX : WEAK_SHIELD_MAX)),
  );
  const types = dealRoundRobin(positions, centres, typeDeck);
  const shieldMax = dealRoundRobin(positions, centres, shieldDeck);

  return { positions, owned, types, shieldMax, imbalance: imbalance(positions, owned) };
}

/** Uniform random points inside the map, `margin` from every edge. */
function randomPoints(rng: Random, count: number, size: number, margin: number): Point[] {
  const span = size - 2 * margin;
  return Array.from({ length: count }, () => ({ x: margin + rng.next() * span, y: margin + rng.next() * span }));
}

/**
 * Pushes points apart: every pair closer than `radius` is moved away from each
 * other, then clamped back inside the margins. Spreads points out without
 * forcing a regular grid.
 */
function relax(points: Point[], size: number, margin: number, radius: number): Point[] {
  const pts = points.map((p) => ({ ...p }));
  const lo = margin;
  const hi = size - margin;
  for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
    const moves = pts.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j]!.x - pts[i]!.x;
        const dy = pts[j]!.y - pts[i]!.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= radius) continue;
        // Coincident points get a fixed, deterministic nudge.
        const ux = d > 1e-9 ? dx / d : 1;
        const uy = d > 1e-9 ? dy / d : 0;
        const push = (radius - d) / 4;
        moves[i]!.x -= ux * push;
        moves[i]!.y -= uy * push;
        moves[j]!.x += ux * push;
        moves[j]!.y += uy * push;
      }
    }
    for (let i = 0; i < pts.length; i++) {
      pts[i]!.x = Math.min(hi, Math.max(lo, pts[i]!.x + moves[i]!.x));
      pts[i]!.y = Math.min(hi, Math.max(lo, pts[i]!.y + moves[i]!.y));
    }
  }
  return pts;
}

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function nearestUnclaimed(positions: Point[], from: Point, claimed: Set<number>): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < positions.length; i++) {
    if (claimed.has(i)) continue;
    const d = dist2(positions[i]!, from);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Each centre in turn takes its nearest unassigned outpost and the next card. */
function dealRoundRobin<T>(positions: Point[], centres: Point[], deck: T[]): T[] {
  const result = new Array<T>(positions.length);
  const assigned = new Set<number>();
  let card = 0;
  while (assigned.size < positions.length) {
    for (const centre of centres) {
      if (assigned.size === positions.length) break;
      const pick = nearestUnclaimed(positions, centre, assigned);
      assigned.add(pick);
      result[pick] = deck[card++]!;
    }
  }
  return result;
}

/**
 * Approximates "every player sends 1 driller to every outpost": each dormant
 * outpost goes to the player whose starting outpost is nearest. Returns the
 * spread (max − min) of resulting outposts per player; lower is fairer.
 */
function imbalance(positions: Point[], owned: number[][]): number {
  const counts = owned.map((o) => o.length);
  const ownedSet = new Set(owned.flat());
  for (let i = 0; i < positions.length; i++) {
    if (ownedSet.has(i)) continue;
    let bestPlayer = 0;
    let bestD = Infinity;
    owned.forEach((outposts, p) => {
      for (const o of outposts) {
        const d = dist2(positions[i]!, positions[o]!);
        if (d < bestD) {
          bestD = d;
          bestPlayer = p;
        }
      }
    });
    counts[bestPlayer]!++;
  }
  return Math.max(...counts) - Math.min(...counts);
}

function buildState(c: Candidate, options: GenerateMapOptions, rng: Random, size: number): GameState {
  const names = outpostNames(rng, c.positions.length);
  const ownerOf = new Map<number, number>();
  c.owned.forEach((outposts, p) => outposts.forEach((o) => ownerOf.set(o, p)));
  const queenAt = new Set(c.owned.map((o) => o[0]!));

  const outposts: Outpost[] = c.positions.map((pos, i) => {
    const p = ownerOf.get(i);
    return {
      id: `o-${i + 1}`,
      name: names[i]!,
      type: c.types[i]!,
      position: pos,
      owner: p === undefined ? null : options.players[p]!.id,
      drillers: p === undefined || queenAt.has(i) ? 0 : STARTING_DRILLERS,
      shieldMax: c.shieldMax[i]!,
      shieldProgress: 0,
      shieldEnabled: true,
    };
  });

  let nextId = 1;
  const specialists: Specialist[] = c.owned.map((o, p) => ({
    id: `spec-${nextId++}`,
    kind: 'queen',
    owner: options.players[p]!.id,
    location: { outpost: `o-${o[0]! + 1}` },
    captiveOf: null,
  }));

  const players: Player[] = options.players.map(({ id, name }) => ({
    id,
    name,
    neptunium: 0,
    minesDrilled: 0,
    eliminated: false,
  }));

  return {
    time: 0,
    seed: options.seed,
    width: size,
    height: size,
    players,
    outposts,
    subs: [],
    specialists,
    nextId,
    winner: null,
    endedAt: null,
    endVotes: [],
  };
}
