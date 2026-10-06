import { distance } from './geometry.js';
import { revealsOutpostTypes, shieldMaxAt, sonarRangeAt } from './specialists.js';
import { shieldCharge } from './shield.js';
import { subPosition } from './simulation.js';
import type { GameState, OutpostView, PlayerId, PlayerView, Point, Sub } from './types.js';

/**
 * Cuts the full state down to what `player` may know (goal.md → Visibility).
 * The server must only ever send this to clients, never the full state.
 *
 * - An outpost is visible if the player owns it or it lies within sonar
 *   range of an outpost they own. Everyone sees every outpost's position and
 *   name, and every mine's type.
 * - A sub is visible if it is the player's, it is inside their sonar, or it
 *   is heading for one of their outposts.
 * - Specialists are visible at visible outposts and on visible subs; a
 *   player always sees their own specialists.
 * - With `revealOwners` (a per-game setting), the owner of every outpost is
 *   known even outside sonar; its contents stay hidden.
 */
export interface ViewOptions {
  revealOwners?: boolean;
}

/** One player's hiring for their own panel: the offer and when the next appears. */
function hiringViewFor(state: GameState, player: PlayerId) {
  const hiring = state.players.find((p) => p.id === player)?.hiring;
  return {
    nextOfferAt: hiring?.nextOfferAt ?? Number.MAX_SAFE_INTEGER,
    offer: hiring?.offer ? structuredClone(hiring.offer) : null,
  };
}

export function viewFor(state: GameState, player: PlayerId, options: ViewOptions = {}): PlayerView {
  // Sonar has a range per outpost: a Princess extends her own, an
  // Intelligence Officer every one of theirs.
  const sonar = state.outposts
    .filter((o) => o.owner === player)
    .map((o) => ({ at: o.position, range: sonarRangeAt(state, o) }));
  const inSonar = (p: Point) => sonar.some((s) => distance(s.at, p) <= s.range);
  const seeTypes = revealsOutpostTypes(state, player);

  const visibleOutposts = new Set<string>();
  const outposts: OutpostView[] = state.outposts.map((o) => {
    const visible = o.owner === player || inSonar(o.position);
    if (!visible) {
      return {
        id: o.id,
        name: o.name,
        position: { ...o.position },
        ...(o.type === 'mine' || seeTypes ? { type: o.type } : {}),
        ...(options.revealOwners ? { owner: o.owner } : {}),
        visible: false,
      };
    }
    visibleOutposts.add(o.id);
    return {
      id: o.id,
      name: o.name,
      position: { ...o.position },
      type: o.type,
      owner: o.owner,
      drillers: o.drillers,
      shieldCharge: shieldCharge(o.shieldProgress),
      shieldMax: o.shieldMax,
      shieldMaxEffective: shieldMaxAt(state, o),
      shieldEnabled: o.shieldEnabled,
      visible: true,
    };
  });

  const ownedIds = new Set(state.outposts.filter((o) => o.owner === player).map((o) => o.id));
  const subVisible = (s: Sub) =>
    s.owner === player || ownedIds.has(s.to) || inSonar(subPosition(state, s, state.time));
  const subs = state.subs.filter(subVisible);
  const visibleSubs = new Set(subs.map((s) => s.id));

  const specialists = state.specialists.filter(
    (s) =>
      s.owner === player ||
      ('outpost' in s.location ? visibleOutposts.has(s.location.outpost) : visibleSubs.has(s.location.sub)),
  );

  return {
    you: player,
    time: state.time,
    width: state.width,
    height: state.height,
    // Deliberately NOT fogged: every player's Neptunium, outpost count and
    // mines drilled are public, like the original game's leaderboard (and
    // drill costs are public). This is the one place fog of war is off on
    // purpose; see docs/architecture.md → Fog of war.
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      neptunium: p.neptunium,
      outpostCount: state.outposts.filter((o) => o.owner === p.id).length,
      minesDrilled: p.minesDrilled,
      eliminated: p.eliminated,
    })),
    outposts,
    subs: structuredClone(subs),
    specialists: structuredClone(specialists),
    // Only this player's own hiring; their decks stay on the server.
    hiring: hiringViewFor(state, player),
    winner: state.winner,
    endedAt: state.endedAt,
    endVotes: [...state.endVotes],
  };
}
