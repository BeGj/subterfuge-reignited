/**
 * Seeded pseudo-random number generator (mulberry32). The engine must be
 * deterministic, so never use `Math.random()` in game logic — the same seed
 * always has to produce the same map and outcomes on server and client.
 */
export interface Random {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Shuffles `items` in place and returns it. */
  shuffle<T>(items: T[]): T[];
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  const shuffle = <T>(items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = int(0, i);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  };

  return { next, int, shuffle };
}
