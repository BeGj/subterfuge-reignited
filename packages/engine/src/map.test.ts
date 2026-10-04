import { describe, expect, it } from 'vitest';
import {
  OUTPOSTS_PER_PLAYER,
  STARTING_DRILLERS,
  STRONG_SHIELD_MAX,
  STRONG_SHIELD_SHARE,
  WEAK_SHIELD_MAX,
} from './constants.js';
import { generateMap } from './map.js';
import type { GameState } from './types.js';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function nearestNeighbourDistances(state: GameState): number[] {
  return state.outposts.map((o) =>
    Math.min(...state.outposts.filter((other) => other !== o).map((other) => dist(o.position, other.position))),
  );
}

describe('generateMap', () => {
  it('is deterministic for the same seed and players', () => {
    expect(generateMap({ seed: 7, players: players(4) })).toEqual(generateMap({ seed: 7, players: players(4) }));
    expect(generateMap({ seed: 7, players: players(4) })).not.toEqual(generateMap({ seed: 8, players: players(4) }));
  });

  // What the snake draft guarantees (checked below): 5 outposts each, the
  // Queen on her owner's outpost with 0 drillers, 40 on the other four, and
  // no outpost shared. It does NOT guarantee "the 5 nearest to the Queen's
  // outpost": picks are measured from the player's (unstored) centre, and in
  // a sample of 600 players over 100 maps that stronger property held for
  // only ~20%. See the deviation notes in map.ts.
  it.each([2, 6, 10])('sets up %i players with the starting rules', (n) => {
    const state = generateMap({ seed: 1, players: players(n) });
    expect(state.outposts).toHaveLength(n * OUTPOSTS_PER_PLAYER);
    expect(new Set(state.outposts.map((o) => o.id)).size).toBe(state.outposts.length);
    expect(new Set(state.outposts.map((o) => o.name)).size).toBe(state.outposts.length);
    expect(state.outposts.some((o) => o.type === 'mine')).toBe(false);

    for (const p of state.players) {
      const owned = state.outposts.filter((o) => o.owner === p.id);
      expect(owned).toHaveLength(5);
      expect(owned.map((o) => o.drillers).sort()).toEqual([0, STARTING_DRILLERS, STARTING_DRILLERS, STARTING_DRILLERS, STARTING_DRILLERS].sort());

      const queens = state.specialists.filter((s) => s.owner === p.id && s.kind === 'queen');
      expect(queens).toHaveLength(1);
      const queenOutpost = state.outposts.find((o) => 'outpost' in queens[0]!.location && o.id === queens[0]!.location.outpost);
      expect(queenOutpost?.owner).toBe(p.id);
      expect(queenOutpost?.drillers).toBe(0);
      expect(queens[0]!.captiveOf).toBeNull();
    }

    const dormant = state.outposts.filter((o) => o.owner === null);
    expect(dormant).toHaveLength(n * (OUTPOSTS_PER_PLAYER - 5));
    expect(dormant.every((o) => o.drillers === 0)).toBe(true);
    expect(state.nextId).toBe(n + 1);
    expect(state).toMatchObject({ time: 0, seed: 1, subs: [], winner: null, endedAt: null });
    expect(state.players.every((p) => p.neptunium === 0 && p.minesDrilled === 0 && !p.eliminated)).toBe(true);
  });

  it('draws the generator share from 30–60%', () => {
    for (let seed = 0; seed < 20; seed++) {
      const state = generateMap({ seed, players: players(5) });
      const share = state.outposts.filter((o) => o.type === 'generator').length / state.outposts.length;
      expect(share).toBeGreaterThanOrEqual(0.3);
      expect(share).toBeLessThanOrEqual(0.6);
    }
  });

  it('uses only weak and strong shields, in the configured share', () => {
    const state = generateMap({ seed: 3, players: players(10) });
    expect(state.outposts.every((o) => o.shieldMax === WEAK_SHIELD_MAX || o.shieldMax === STRONG_SHIELD_MAX)).toBe(true);
    const strong = state.outposts.filter((o) => o.shieldMax === STRONG_SHIELD_MAX).length;
    expect(strong).toBe(Math.round(state.outposts.length * STRONG_SHIELD_SHARE));
    expect(state.outposts.every((o) => o.shieldProgress === 0 && o.shieldEnabled)).toBe(true);
  });

  it('keeps outposts in bounds and sensibly spaced', () => {
    for (const n of [2, 6, 10]) {
      const state = generateMap({ seed: 11, players: players(n) });
      for (const { position: p } of state.outposts) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(state.width);
        expect(p.y).toBeLessThan(state.height);
        expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
      }
      const nn = nearestNeighbourDistances(state);
      expect(Math.min(...nn)).toBeGreaterThan(120);
      const mean = nn.reduce((a, b) => a + b, 0) / nn.length;
      expect(mean).toBeGreaterThanOrEqual(240);
      expect(mean).toBeLessThanOrEqual(480);
    }
  });

  it('picks a balanced map', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const state = generateMap({ seed: 5, players: players(n) });
      const counts = state.players.map((p) => 0 * p.neptunium);
      const starts = state.players.map((p) => state.outposts.filter((o) => o.owner === p.id));
      for (const o of state.outposts) {
        let best = 0;
        let bestD = Infinity;
        starts.forEach((owned, i) => {
          for (const s of owned) {
            const d = dist(o.position, s.position);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        });
        counts[best]!++;
      }
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
    }
  });

  it('rejects bad player lists', () => {
    expect(() => generateMap({ seed: 1, players: players(1) })).toThrow();
    expect(() => generateMap({ seed: 1, players: players(11) })).toThrow();
    expect(() => generateMap({ seed: 1, players: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] })).toThrow();
  });

  it('generates a 10-player map in under a second', () => {
    const start = performance.now();
    generateMap({ seed: 99, players: players(10) });
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
