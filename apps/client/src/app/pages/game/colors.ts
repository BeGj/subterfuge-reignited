import type { PlayerId, PlayerView } from '@subterfuge/engine';

/**
 * Player colours, chosen to be distinguishable on the dark sea background
 * (all ≥ 4.5:1 against --bg #07131f).
 */
export const PLAYER_COLORS = [
  '#4fd1c5', // teal
  '#ff8a65', // coral
  '#b39ddb', // lavender
  '#ffd54f', // amber
  '#81c784', // green
  '#f48fb1', // pink
  '#64b5f6', // blue
  '#e0e0e0', // silver
  '#ffab40', // orange
  '#a1887f', // taupe
] as const;

export const DORMANT_COLOR = '#6b7f8e';
export const UNKNOWN_COLOR = '#3c5366';

/** Colour for a player id by their index in `view.players` (stable for the game). */
export function playerColor(view: PlayerView, player: PlayerId | null | undefined): string {
  if (player === null) return DORMANT_COLOR;
  if (player === undefined) return UNKNOWN_COLOR;
  const index = view.players.findIndex((p) => p.id === player);
  return index < 0 ? UNKNOWN_COLOR : PLAYER_COLORS[index % PLAYER_COLORS.length]!;
}
