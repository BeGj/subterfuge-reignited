import { TestBed } from '@angular/core/testing';
import { Realtime, STUCK_AFTER_MS } from './realtime';

describe('Realtime stuck detection', () => {
  it('flags a connection that keeps failing, even with retries in between', () => {
    vi.useFakeTimers();
    const rt = TestBed.inject(Realtime);
    const setStatus = (s: 'connecting' | 'connected') => (rt as unknown as { setStatus(s: string): void }).setStatus(s);
    setStatus('connecting');
    // A failed retry every 4 s must not restart the countdown.
    for (let t = 0; t < STUCK_AFTER_MS; t += 4000) {
      vi.advanceTimersByTime(4000);
      setStatus('connecting');
    }
    expect(rt.stuck()).toBe(true);
    setStatus('connected');
    expect(rt.stuck()).toBe(false);
    vi.useRealTimers();
  });
});
