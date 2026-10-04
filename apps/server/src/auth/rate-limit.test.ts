import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.ts';

describe('RateLimiter', () => {
  it('allows `limit` attempts per window, then blocks until it resets', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 1000, () => now);
    expect([1, 2, 3, 4].map(() => limiter.attempt('k'))).toEqual([true, true, true, false]);
    now = 1000;
    expect(limiter.attempt('k')).toBe(true);
  });

  it('tracks keys independently and can reset one', () => {
    const limiter = new RateLimiter(1, 1000, () => 0);
    expect(limiter.attempt('a')).toBe(true);
    expect(limiter.attempt('a')).toBe(false);
    expect(limiter.attempt('b')).toBe(true);
    limiter.reset('a');
    expect(limiter.attempt('a')).toBe(true);
  });
});
