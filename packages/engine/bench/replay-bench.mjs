// Replay benchmark: how long does the server's load() take to rebuild a game?
//
//   npm run build -w @subterfuge/engine && node packages/engine/bench/replay-bench.mjs
//
// Builds a 10-player game with a realistic order stream (every player
// launches every ~2 game hours from an outpost with drillers to one of its
// nearest neighbours), then measures replaying that log from minute 0 to
// N game days, both in one advance() call (server load) and tick by tick
// (the live runtime).

import { DAY, HOUR, TICK, advance, createRandom, distance, generateMap } from '../dist/index.js';

const PLAYERS = 10;
const HORIZONS = [1, 7, 30, 90].map((d) => d * DAY);
const rnd = createRandom(99);

function buildOrderLog(start, end) {
  const orders = [];
  let state = start;
  for (let t = 2 * HOUR; t <= end; t += 2 * HOUR) {
    for (const p of state.players) {
      if (p.eliminated) continue;
      const armies = state.outposts.filter((o) => o.owner === p.id && o.drillers > 6);
      if (armies.length === 0) continue;
      const from = armies[rnd.int(0, armies.length - 1)];
      const near = state.outposts
        .filter((o) => o.id !== from.id)
        .sort((a, b) => distance(a.position, from.position) - distance(b.position, from.position))
        .slice(0, 4);
      const to = near[rnd.int(0, near.length - 1)];
      orders.push({ kind: 'launch', at: t, player: p.id, from: from.id, to: to.id, drillers: Math.ceil(from.drillers / 2), specialists: [] });
    }
    state = advance(state, orders, t).state;
  }
  return { orders, end: state };
}

function time(fn) {
  const t0 = performance.now();
  const result = fn();
  return { ms: performance.now() - t0, result };
}

const start = generateMap({ seed: 7, players: Array.from({ length: PLAYERS }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })) });
const built = time(() => buildOrderLog(start, HORIZONS.at(-1)));
const { orders } = built.result;
console.log(`order log: ${orders.length} orders over ${HORIZONS.at(-1) / DAY} game days (built in ${built.ms.toFixed(0)} ms)`);

console.log('\nhorizon | ticks  | subs in flight (end) | one call ms | ticks/s  | tick-by-tick ms | ticks/s | live (pruned) µs/tick');
for (const until of HORIZONS) {
  const ticks = until / TICK;
  const once = time(() => advance(start, orders, until));
  const stepped = time(() => {
    let s = start;
    for (let t = TICK; t <= until; t += TICK) s = advance(s, orders, t).state;
    return s;
  });
  // The live runtime drops executed orders, so each call only sees future ones.
  const live = time(() => {
    let s = start;
    let rest = orders;
    for (let t = TICK; t <= until; t += TICK) {
      s = advance(s, rest, t).state;
      rest = rest.filter((o) => o.at > t);
    }
    return s;
  });
  if (JSON.stringify(once.result.state) !== JSON.stringify(stepped.result)) throw new Error('chunked replay diverged!');
  if (JSON.stringify(once.result.state) !== JSON.stringify(live.result)) throw new Error('live replay diverged!');
  console.log(
    `${String(until / DAY).padStart(4)} d  | ${String(ticks).padStart(6)} | ${String(once.result.state.subs.length).padStart(20)} | ${once.ms.toFixed(0).padStart(11)} | ${Math.round(ticks / (once.ms / 1000)).toString().padStart(8)} | ${stepped.ms.toFixed(0).padStart(15)} | ${String(Math.round(ticks / (stepped.ms / 1000))).padStart(7)} | ${Math.round((live.ms * 1000) / ticks)}`,
  );
}
