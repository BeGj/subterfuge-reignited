import { FACTORY_CYCLE, type GameClock } from '@subterfuge/engine';

/** Client-side game clock, corrected for the difference between server and local time. */
export interface ClockSync {
  startedAtMs: number;
  speed: number;
  /** serverTime − localTime, in ms. */
  offsetMs: number;
}

export function syncClock(clock: GameClock, receivedAtMs: number): ClockSync {
  return {
    startedAtMs: Date.parse(clock.startedAt),
    speed: clock.speed,
    offsetMs: Date.parse(clock.serverNow) - receivedAtMs,
  };
}

/** Fractional game minute at local time `nowMs`. */
export function gameMinuteAt(sync: ClockSync, nowMs: number): number {
  return Math.max(0, ((nowMs + sync.offsetMs - sync.startedAtMs) / 60_000) * sync.speed);
}

/** Game minutes until the next factory production cycle. */
export function minutesToNextProduction(minute: number): number {
  const next = (Math.floor(minute / FACTORY_CYCLE) + 1) * FACTORY_CYCLE;
  return next - minute;
}
