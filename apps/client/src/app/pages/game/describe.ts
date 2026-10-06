import { specialistName } from '@subterfuge/engine';
import type { GameEvent, Order, PendingOrder, PlayerView, SpecialistKind } from '@subterfuge/engine';
import { formatDuration } from './format';

export interface Names {
  outpost(id: string): string;
  player(id: string | null): string;
}

export function namesFor(view: PlayerView): Names {
  const outposts = new Map(view.outposts.map((o) => [o.id, o.name]));
  const players = new Map(view.players.map((p) => [p.id, p.id === view.you ? 'You' : p.name]));
  return {
    outpost: (id) => outposts.get(id) ?? id,
    player: (id) => (id === null ? 'nobody' : (players.get(id) ?? id)),
  };
}

/** One line describing an order ("Launch 10 drillers Kelthal → Vorn"). */
export function describeOrder(order: Order, names: Names): string {
  switch (order.kind) {
    case 'launch': {
      const cargo = [`${order.drillers} drillers`, ...(order.specialists.length ? [`${order.specialists.length} specialist(s)`] : [])];
      return `${order.isGift ? 'Gift' : 'Launch'} ${cargo.join(' + ')} ${names.outpost(order.from)} → ${names.outpost(order.to)}`;
    }
    case 'drillMine':
      return `Drill mine at ${names.outpost(order.outpost)}`;
    case 'setShield':
      return `Turn shield ${order.enabled ? 'on' : 'off'} at ${names.outpost(order.outpost)}`;
    case 'hire':
      return `Hire a ${specialistName(order.choice)}`;
    case 'promote':
      return 'Promote a specialist';
    case 'redirect':
      return `Redirect a sub to ${names.outpost(order.to)}`;
    case 'resign':
      return 'Resign from the game';
    case 'voteEnd':
      return order.agree ? 'Propose ending the game' : 'Withdraw your proposal to end the game';
  }
}

/** Human-readable specialist name ("Security Chief"). */
export function specialistLabel(kind: SpecialistKind): string {
  return specialistName(kind);
}

/** "for you" / "for bob", so "You's ..." never happens. */
function forWhom(names: Names, player: string): string {
  return names.player(player) === 'You' ? 'for you' : `for ${names.player(player)}`;
}

export function describePending(pending: PendingOrder, names: Names, now: number): string {
  const wait = pending.order.at - now;
  return `${describeOrder(pending.order, names)} — ${wait > 0 ? `in ${formatDuration(wait)}` : 'now'}`;
}

/** Human-readable event text. */
export function describeEvent(event: GameEvent, names: Names): string {
  switch (event.kind) {
    case 'orderRejected':
      return `Order failed: ${describeOrder(event.order, names)} (${event.reason})`;
    case 'subLaunched':
      return `${names.player(event.owner)} launched a sub ${names.outpost(event.from)} → ${names.outpost(event.to)}`;
    case 'subArrived':
      return `${possessive(names.player(event.owner))} sub arrived at ${names.outpost(event.outpost)}`;
    case 'outpostCaptured':
      return event.from === null
        ? `${names.player(event.to)} claimed ${names.outpost(event.outpost)}`
        : `${names.player(event.to)} captured ${names.outpost(event.outpost)} from ${names.player(event.from)}`;
    case 'combat': {
      const where = event.outpost ? `at ${names.outpost(event.outpost)}` : 'between subs';
      const effects = event.details.effects?.length ? ` (${event.details.effects.join('; ')})` : '';
      return `Combat ${where}: ${event.winner ? `${names.player(event.winner)} won` : 'draw'}${effects}`;
    }
    case 'mineDrilled':
      return `${names.player(event.player)} drilled a mine at ${names.outpost(event.outpost)}`;
    case 'subRedirected':
      return `${names.player(event.owner)}: sub redirected to ${names.outpost(event.to)}`;
    case 'specialistOffered':
      return `A specialist offer is waiting`;
    case 'specialistHired':
      return `${names.player(event.player)} hired ${event.kinds.map(specialistName).join(' and ')} at ${names.outpost(event.outpost)}`;
    case 'specialistPromoted':
      return `${names.player(event.player)} promoted a ${specialistName(event.from)} to ${specialistName(event.to)} at ${names.outpost(event.outpost)}`;
    case 'queenSucceeded':
      return `A Princess took over as Queen ${forWhom(names, event.player)}`;
    case 'specialistCaptured':
      return `${names.player(event.by)} captured ${count(event.specialists.length, 'specialist')} at ${names.outpost(event.outpost)}`;
    case 'specialistDestroyed':
      return `${count(event.specialists.length, 'specialist')} lost`;
    case 'playerEliminated': {
      const who = names.player(event.player);
      const why = event.reason === 'resigned' ? 'resigned' : 'Queen captured';
      return `${who} ${who === 'You' ? 'were' : 'was'} eliminated (${why})`;
    }
    case 'gameWon':
      return `${names.player(event.player)} won the game (${event.reason === 'neptunium' ? 'Neptunium' : 'last one standing'})`;
    case 'gameDrawn':
      return event.reason === 'agreed' ? 'The game ended by agreement (no winner)' : 'The game ended in a draw';
    case 'endVote':
      return event.agree
        ? `${names.player(event.player)} proposed ending the game`
        : `${names.player(event.player)} withdrew their proposal to end the game`;
  }
}

/** "Your" for you, "Alice's" for anyone else. */
function possessive(name: string): string {
  return name === 'You' ? 'Your' : `${name}'s`;
}

/** "a specialist", "3 specialists". */
function count(n: number, noun: string): string {
  return n === 1 ? `a ${noun}` : `${n} ${noun}s`;
}
