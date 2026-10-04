import { DAY, HOUR, NEPTUNIUM_UNIT } from '@subterfuge/engine';

const pad = (n: number) => String(n).padStart(2, '0');

/** Game minute → "Day 1, 04:30" (day 1 starts at minute 0). */
export function formatGameTime(minute: number): string {
  const m = Math.max(0, Math.floor(minute));
  const day = Math.floor(m / DAY) + 1;
  const inDay = m % DAY;
  return `Day ${day}, ${pad(Math.floor(inDay / HOUR))}:${pad(inDay % HOUR)}`;
}

/** Game minutes → compact duration: "8m", "6h 10m", "2d 3h". Rounds up to whole minutes. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.ceil(minutes));
  if (m < HOUR) return `${m}m`;
  if (m < DAY) {
    const rest = m % HOUR;
    return rest ? `${Math.floor(m / HOUR)}h ${rest}m` : `${Math.floor(m / HOUR)}h`;
  }
  const hours = Math.floor((m % DAY) / HOUR);
  return hours ? `${Math.floor(m / DAY)}d ${hours}h` : `${Math.floor(m / DAY)}d`;
}

/** Stored neptunium units → kg with one decimal ("12.5"). */
export function formatNeptunium(units: number): string {
  return (Math.floor((units / NEPTUNIUM_UNIT) * 10) / 10).toFixed(1);
}

/** Game speed (game minutes per real minute) → label. */
export function formatSpeed(speed: number): string {
  return speed === 1 ? 'Real time' : `${speed}× speed`;
}
