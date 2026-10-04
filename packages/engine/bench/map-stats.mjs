// Map geometry stats: what each player count actually feels like.
//
//   npm run build -w @subterfuge/engine && node packages/engine/bench/map-stats.mjs
//
// Prints, per player count, how far apart neighbouring outposts end up (i.e.
// travel time at 1.0 speed) and how much of the map one outpost's sonar
// covers. The two cannot both be held constant — see SPACING_SCALE_EXPONENT
// in packages/engine/src/map.ts — so this is the table to decide on.

import {
  DAY,
  HOUR,
  MAX_PLAYERS,
  OUTPOST_SPACING,
  SONAR_RANGE,
  generateMap,
  mapSize,
} from '../dist/index.js';

const SAMPLES = 5;
const GRID = 40; // resolution of the sonar-coverage estimate

console.log(`OUTPOST_SPACING ${OUTPOST_SPACING}, SONAR_RANGE ${SONAR_RANGE} (${SONAR_RANGE} min = ${SONAR_RANGE / HOUR} h)\n`);

const header = [
  'players',
  'map',
  'neighbour travel',
  'sonar rings',
  // Per player count: the player who sees the most of the map (least fog)
  // and the one who sees the least.
  'most seen (1 player)',
  'least seen (1 player)',
];
console.log(header.map((h) => h.padEnd(23)).join(''));

for (let n = 2; n <= MAX_PLAYERS; n++) {
  const size = mapSize(n);
  let neighbourSum = 0;
  let counted = 0;
  let mostSeen = 0;
  let leastSeen = 1;
  for (let s = 0; s < SAMPLES; s++) {
    const state = generateMap({
      seed: 1000 + s,
      players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `p${i + 1}` })),
    });
    // Nearest-neighbour distance for every outpost: the travel a player
    // actually makes most often, and the thing sonar is measured in.
    for (const a of state.outposts) {
      let bestD = Infinity;
      for (const b of state.outposts) {
        if (a === b) continue;
        bestD = Math.min(bestD, Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y));
      }
      if (Number.isFinite(bestD)) {
        neighbourSum += bestD;
        counted++;
      }
    }

    // How much of the map each player can see, as the union of the sonar of
    // the outposts they own. This is the number that decides whether fog of
    // war exists at all: at 100 % there is none, however big the map is.
    for (const player of state.players) {
      const owned = state.outposts.filter((o) => o.owner === player.id);
      let seen = 0;
      for (let gx = 0; gx < GRID; gx++) {
        for (let gy = 0; gy < GRID; gy++) {
          const x = ((gx + 0.5) / GRID) * size;
          const y = ((gy + 0.5) / GRID) * size;
          if (owned.some((o) => Math.hypot(o.position.x - x, o.position.y - y) <= SONAR_RANGE)) seen++;
        }
      }
      const share = seen / (GRID * GRID);
      mostSeen = Math.max(mostSeen, share);
      leastSeen = Math.min(leastSeen, share);
    }
  }
  const neighbour = neighbourSum / counted;
  const travelH = neighbour / 60;
  const rings = SONAR_RANGE / neighbour;

  console.log(
    [
      String(n),
      String(size),
      `${travelH.toFixed(1)} h`,
      rings.toFixed(1),
      `${(mostSeen * 100).toFixed(0)} %`,
      `${(leastSeen * 100).toFixed(0)} %`,
    ]
      .map((c) => c.padEnd(23))
      .join(''),
  );
}

console.log(
  '\n"coverage" = share of the map inside the sonar of the 5 outposts a player owns.',
);
console.log('100 % means no fog of war at all. 60-80 % is roughly the original\'s feel.\n');

// Real time vs game time at the fastest preset, for scale. Speed is game
// minutes per real minute.
const realHourAt240 = 60 * 240;
console.log(`1 real hour at speed 240 = ${realHourAt240.toLocaleString()} game minutes = ${realHourAt240 / DAY} game days`);