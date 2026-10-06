// End-to-end smoke test against a running server: register two accounts,
// create and start a game, connect both sockets, send a sub to a dormant
// outpost and wait for it to be captured.
//
//   npm run db:up && npm run dev        # in one terminal
//   node scripts/smoke.mjs              # in another
//
// This is the check that a real 2-player game is playable. It fails loudly
// rather than skipping, and it never touches a game you are playing: it makes
// its own with a throwaway name.
//
// Registering is rate limited to 10 accounts per IP per hour, so this can run
// five times an hour from one machine before the last run fails on that.

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const stamp = Date.now().toString(36);
const SPEED = 240; // game minutes per real minute, so a sub arrives in seconds

let failures = 0;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok)
    throw new Error(`${method} ${path} -> ${res.status}: ${json.error ?? text.slice(0, 200)}`);
  return json;
}

async function register(username) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'correct-horse-battery' }),
  });
  const body = await res.json();
  if (!res.ok)
    throw new Error(`register ${username} -> ${res.status}: ${body.error ?? res.statusText}`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sid='));
  if (!cookie) throw new Error('register returned no session cookie');
  return { user: body, cookie: cookie.split(';')[0] };
}

// Socket.IO connection authenticated with the session cookie, like the browser.
async function connect(cookie) {
  const { io } = await import('socket.io-client');
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      forceNew: true,
    });
    socket.on('hello', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timed out')), 10_000);
  });
}

const watch = (socket, gameId) =>
  new Promise((resolve, reject) => {
    socket.emit('watchGame', gameId, (ack) =>
      ack.ok ? resolve(ack.snapshot) : reject(new Error(ack.error)),
    );
    setTimeout(() => reject(new Error('watchGame timed out')), 10_000);
  });

const order = (socket, request) =>
  new Promise((resolve, reject) => {
    socket.emit('issueOrder', request, (ack) =>
      ack.ok ? resolve(ack.pending) : reject(new Error(ack.error)),
    );
    setTimeout(() => reject(new Error('issueOrder timed out')), 10_000);
  });

// Wait for a snapshot predicate to hold, via the game's live updates.
function until(
  socket,
  predicate,
  what,
  timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 300_000),
) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('gameUpdate', onUpdate);
      reject(new Error(`timed out waiting for ${what}`));
    }, timeoutMs);
    function onUpdate(snapshot) {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      socket.off('gameUpdate', onUpdate);
      resolve(snapshot);
    }
    socket.on('gameUpdate', onUpdate);
  });
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);

  const alice = await register(`smoke_a_${stamp}`);
  const bob = await register(`smoke_b_${stamp}`);
  step(
    'two accounts registered',
    Boolean(alice.cookie && bob.cookie),
    `${alice.user.username}, ${bob.user.username}`,
  );

  const game = await call('/api/games', {
    method: 'POST',
    cookie: alice.cookie,
    // Owners hidden, so the fog-of-war check below can test that nothing at
    // all about hidden outposts leaks.
    body: { name: `smoke-${stamp}`, maxPlayers: 2, speed: SPEED, revealOwners: false },
  });
  step('game created', Boolean(game.id), game.id);

  await call(`/api/games/${game.id}/join`, { method: 'POST', cookie: bob.cookie });
  step('second player joined', true);

  const lobby = await call('/api/games', { cookie: bob.cookie });
  const mine = lobby.find((g) => g.id === game.id);
  step(
    'game appears in the lobby',
    mine?.players?.length === 2,
    `${mine?.players?.length} players`,
  );

  await call(`/api/games/${game.id}/start`, { method: 'POST', cookie: alice.cookie });
  step('game started', true);

  const aliceSocket = await connect(alice.cookie);
  const bobSocket = await connect(bob.cookie);
  step('both sockets connected and authenticated', true);

  const snap = await watch(aliceSocket, game.id);
  const you = snap.view.you;
  const mine1 = snap.view.outposts.filter((o) => o.owner === you && o.drillers >= 40);
  step(
    'snapshot received',
    snap.view.outposts.length === 20,
    `${snap.view.outposts.length} outposts, you are ${you}`,
  );
  step(
    'starting outposts present',
    mine1.length === 4,
    `${mine1.length} outposts with >= 40 drillers`,
  );

  // Fog of war: Alice must not see everything.
  const unseen = snap.view.outposts.filter((o) => !o.visible).length;
  step(
    'fog of war hides some outposts',
    unseen > 0,
    `${unseen} of ${snap.view.outposts.length} not visible`,
  );
  const leaked = snap.view.outposts.filter(
    (o) => !o.visible && (o.owner !== undefined || o.drillers !== undefined || o.shieldCharge !== undefined),
  ).length;
  step('hidden outposts leak no owner, drillers or shield', leaked === 0, `${leaked} leaks`);

  // Launch a sub at the nearest visible *dormant* outpost and wait for it to
  // be captured. Any other target is a coin flip: an enemy outpost holds 40
  // drillers, and our own outpost wouldn't test a capture at all.
  const dist = (o) => Math.hypot(o.position.x - mine1[0].position.x, o.position.y - mine1[0].position.y);
  const target = snap.view.outposts
    .filter((o) => o.visible && o.owner === null)
    .sort((x, y) => dist(x) - dist(y))[0];
  if (!target) throw new Error('no visible dormant outpost to capture');
  const pending = await order(aliceSocket, {
    gameId: game.id,
    order: { kind: 'launch', from: mine1[0].id, to: target.id, drillers: 20, specialists: [] },
  });
  step('launch order accepted', Boolean(pending.id), `order ${pending.id}`);

  const launched = await until(
    aliceSocket,
    (s) => s.events.some((e) => e.kind === 'subLaunched'),
    'subLaunched',
  );
  const from = launched.view.outposts.find((o) => o.id === mine1[0].id);
  step(
    'sub launched from the origin outpost',
    from.drillers === 20,
    `${from.drillers} drillers left`,
  );

  const captured = await until(
    aliceSocket,
    (s) => s.events.some((e) => e.kind === 'outpostCaptured' && e.outpost === target.id),
    'outpostCaptured',
  );
  const destination = captured.view.outposts.find((o) => o.id === target.id);
  step(
    'dormant outpost captured',
    destination.owner === you && destination.drillers >= 20,
    `${destination.name}: owner ${destination.owner}, ${destination.drillers} drillers`,
  );

  // Hiring: the Queen gets her first offer 4 game hours in (1 real minute at
  // blitz), and only Alice may see it.
  const offered = await until(aliceSocket, (s) => s.view.hiring.offer !== null, 'a hire offer');
  const cards = Object.entries(offered.view.hiring.offer.kinds);
  step('first specialist offer arrives at hour 4', cards.length >= 2, `${cards.length} cards: ${cards.map(([, k]) => k).join(', ')}`);

  const bobOffer = await watch(bobSocket, game.id);
  const bobOwnOffer = bobOffer.view.hiring.offer !== null;
  const bobSeesAlices = bobOffer.view.hiring.offer?.kinds === offered.view.hiring.offer?.kinds;
  step("nobody else's offer is visible", !(bobOwnOffer && bobSeesAlices), 'offer is private');

  const choice = cards[0][1];
  await order(aliceSocket, { gameId: game.id, order: { kind: 'hire', choice } });
  const hired = await until(
    aliceSocket,
    (s) => s.view.specialists.some((x) => x.kind === choice && x.owner === s.view.you),
    'the hired specialist',
  );
  const queen = hired.view.specialists.find((x) => x.kind === 'queen' && x.owner === hired.view.you);
  const newSpec = hired.view.specialists.find((x) => x.kind === choice && x.owner === hired.view.you);
  step(
    'hired specialist appears at the Queen\'s outpost',
    newSpec && queen && newSpec.location.outpost === queen.location.outpost,
    `${choice} at ${newSpec?.location.outpost} (Queen at ${queen?.location.outpost})`,
  );
  step('offer is cleared once taken', hired.view.hiring.offer === null, 'no pending offer');

  // Alice's own launch must never reach Bob's event feed.
  const bobSnap = await watch(bobSocket, game.id);
  const bobSeesLaunch = bobSnap.events.some((e) => e.kind === 'subLaunched' && e.owner === you);
  step(
    "Bob cannot see Alice's launches",
    !bobSeesLaunch,
    `${bobSnap.events.length} events visible to Bob`,
  );

  // Clean up: end the game so it doesn't linger in anyone's lobby (a started
  // game can't be deleted; a finished one is listed only for its players).
  // Listen before acting: the order's ack and the final update can arrive
  // back-to-back, and a finished game sends no further updates.
  const endedPromise = until(bobSocket, (s) => s.view.endedAt !== null, 'game end');
  await order(aliceSocket, { gameId: game.id, order: { kind: 'resign' } });
  const ended = await endedPromise;
  step('game ended for clean-up', ended.view.winner === 'p2', `winner ${ended.view.winner}`);

  aliceSocket.close();
  bobSocket.close();
  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nSmoke test could not run: ${err.message}`);
  console.error('Is the server up? npm run db:up && npm run dev');
  process.exit(1);
});
