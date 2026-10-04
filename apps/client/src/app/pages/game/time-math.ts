import { DAY, HOUR, LAUNCH_DELAY, TICK, type ArrivalPrediction, type PlayerId } from '@subterfuge/engine';

/** How far the scrubber reaches at least, beyond "now". */
export const MIN_HORIZON = 3 * DAY;
/** Extra room past the latest predicted arrival, so you can watch it land. */
export const HORIZON_PADDING = 6 * HOUR;
/** Playback speed of the time machine: game minutes per real second. */
export const PLAY_RATE = 120;

/** The tick a (fractional) game minute belongs to. */
export function tickOf(minute: number): number {
  return Math.floor(minute / TICK) * TICK;
}

/** First tick at or after a (fractional) game minute. */
export function tickAtOrAfter(minute: number): number {
  return Math.ceil(minute / TICK) * TICK;
}

/** Furthest point of the scrubber: 3 game days, or past the last arrival. */
export function scrubHorizon(liveMinute: number, predictions: readonly ArrivalPrediction[]): number {
  const latest = predictions.reduce((max, p) => Math.max(max, p.at), 0);
  return tickAtOrAfter(Math.max(liveMinute + MIN_HORIZON, latest + HORIZON_PADDING));
}

/**
 * When an order issued while looking at `scrubMinute` should execute.
 *
 * The map shows the state *after* tick `tickOf(scrubMinute)` (including that
 * tick's arrivals), but an order scheduled for tick T runs at the *start* of
 * T, before T's arrivals. So the order runs one tick later, which makes it act
 * on exactly what's on screen. Example: jump to your sub's arrival, then
 * launch the arrived drillers onward. Never earlier than the server allows
 * (next tick, plus the launch delay for launches).
 */
export function scheduledAt(scrubMinute: number, liveMinute: number, isLaunch: boolean): number {
  const earliest = tickAtOrAfter(liveMinute + (isLaunch ? LAUNCH_DELAY : 0));
  return Math.max(tickOf(scrubMinute) + TICK, earliest, tickOf(liveMinute) + TICK);
}

/** A prediction seen from your side of the fight. */
export type YourOutcome = 'win' | 'lose' | 'unknown' | 'none';

/**
 * Win/lose from `you`'s point of view. Predictions are from the sub owner's
 * side, so an enemy sub that "wins" against your outpost is a loss for you.
 * Fights you're not part of (and peaceful arrivals) are 'none'.
 */
export function outcomeFor(prediction: ArrivalPrediction, you: PlayerId): YourOutcome {
  if (prediction.outcome === 'safe') return 'none';
  const involved = prediction.owner === you || (prediction.combat?.details.sides.some((s) => s.player === you) ?? false);
  if (!involved) return 'none';
  if (prediction.outcome === 'unknown') return 'unknown';
  if (prediction.owner === you) return prediction.outcome;
  return prediction.outcome === 'win' ? 'lose' : 'win';
}

/**
 * One line about a predicted fight, from your side. For a launch you'd lose,
 * says how many more drillers it needs (ties go to the defender).
 */
export function outcomeSummary(prediction: ArrivalPrediction, you: PlayerId): string {
  const outcome = outcomeFor(prediction, you);
  if (prediction.outcome === 'safe') return 'Arrives without a fight.';
  if (outcome === 'unknown') return "Outcome unknown: the target is outside your sonar.";
  const sides = prediction.combat?.details.sides ?? [];
  const mine = sides.find((s) => s.player === you);
  if (outcome === 'win') return `Wins with ${mine?.drillersAfter ?? 0} drillers left.`;
  if (outcome === 'lose') {
    if (prediction.owner === you) {
      const enemy = sides.find((s) => s.player !== you);
      const shield = prediction.combat?.details.shieldAfter ?? 0;
      const needed = (enemy?.drillersAfter ?? 0) + shield + 1;
      return `Loses: needs about ${needed} more drillers.`;
    }
    return prediction.combat?.outpost ? 'Your outpost is predicted to fall.' : 'Your sub is predicted to lose this fight.';
  }
  return '';
}

/** Shortest and longest "travel" animation through time, in ms. */
export const TRAVEL_MIN_MS = 500;
export const TRAVEL_MAX_MS = 1800;

/**
 * How long animating through `minutes` of game time takes: longer jumps take
 * longer, but never so long that it feels like waiting.
 */
export function travelDuration(minutes: number): number {
  const ms = TRAVEL_MIN_MS + Math.abs(minutes) * 0.6;
  return Math.min(TRAVEL_MAX_MS, Math.max(TRAVEL_MIN_MS, ms));
}

/** Ease-in-out (cubic): starts and ends gently. `t` in [0, 1]. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
