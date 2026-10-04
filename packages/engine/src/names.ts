import type { Random } from './random.js';

// Outpost names are built from two syllable lists, giving 26 × 18 = 468
// unique, pronounceable names — enough for 10 players × 10 outposts.
const STARTS = [
  'Ab', 'Bal', 'Cor', 'Del', 'Ek', 'Fal', 'Gan', 'Hal', 'Ith', 'Jor', 'Kel', 'Lun', 'Mar',
  'Nor', 'Os', 'Pel', 'Quar', 'Ros', 'Sel', 'Tor', 'Ul', 'Var', 'Wen', 'Xan', 'Yor', 'Zel',
];
const ENDS = [
  'aris', 'bek', 'dor', 'ena', 'gard', 'holm', 'ion', 'ka', 'lith',
  'mere', 'nox', 'ora', 'quay', 'rift', 'sund', 'thal', 'vik', 'wyn',
];

export const MAX_OUTPOST_NAMES = STARTS.length * ENDS.length;

/** `count` unique outpost names in a seeded random order. */
export function outpostNames(rng: Random, count: number): string[] {
  if (count > MAX_OUTPOST_NAMES) throw new Error(`At most ${MAX_OUTPOST_NAMES} outpost names available`);
  const all = STARTS.flatMap((start) => ENDS.map((end) => start + end));
  return rng.shuffle(all).slice(0, count);
}
