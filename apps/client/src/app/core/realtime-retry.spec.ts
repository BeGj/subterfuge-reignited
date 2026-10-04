import { retryDelay } from './realtime';

describe('retryDelay', () => {
  it('backs off exponentially and caps at 10 s', () => {
    expect([0, 1, 2, 3, 4, 5].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
  });
});
