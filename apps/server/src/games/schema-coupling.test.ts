import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICK } from '@subterfuge/engine';

// SQL can't import TypeScript constants, so the migrations repeat a few of
// them. These tests fail if the copies drift apart.
describe('schema ↔ engine constants', () => {
  it('orders.at_minute CHECK uses the engine TICK', () => {
    const sql = readFileSync(new URL('../../migrations/002_games.sql', import.meta.url), 'utf8');
    const match = /at_minute % (\d+) = 0/.exec(sql);
    expect(Number(match?.[1])).toBe(TICK);
  });
});
