import type { GameEvent, Order, PendingOrder, PlayerView } from '@subterfuge/engine';
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
    case 'resign':
      return 'Resign from the game';
  }
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
      return `${names.player(event.owner)}'s sub arrived at ${names.outpost(event.outpost)}`;
    case 'outpostCaptured':
      return event.from === null
        ? `${names.player(event.to)} claimed ${names.outpost(event.outpost)}`
        : `${names.player(event.to)} captured ${names.outpost(event.outpost)} from ${names.player(event.from)}`;
    case 'combat': {
      const where = event.outpost ? `at ${names.outpost(event.outpost)}` : 'between subs';
      return `Combat ${where}: ${event.winner ? `${names.player(event.winner)} won` : 'draw'}`;
    }
    case 'mineDrilled':
      return `${names.player(event.player)} drilled a mine at ${names.outpost(event.outpost)}`;
    case 'playerEliminated': {
      const who = names.player(event.player);
      const why = event.reason === 'resigned' ? 'resigned' : 'Queen captured';
      return `${who} ${who === 'You' ? 'were' : 'was'} eliminated (${why})`;
    }
    case 'gameWon':
      return `${names.player(event.player)} won the game (${event.reason === 'neptunium' ? 'Neptunium' : 'last one standing'})`;
    case 'gameDrawn':
      return 'The game ended in a draw';
  }
}
