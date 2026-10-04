import { isOutdated, runningBuild } from './realtime';

describe('client build check', () => {
  it('finds the running build from the main bundle name', () => {
    const doc = document.implementation.createHTMLDocument('x');
    const script = doc.createElement('script');
    script.setAttribute('src', 'main-ABC123XY.js');
    doc.body.append(script);
    expect(runningBuild(doc)).toBe('ABC123XY');
  });

  it('is null in development (unhashed main.js)', () => {
    const doc = document.implementation.createHTMLDocument('x');
    const script = doc.createElement('script');
    script.setAttribute('src', 'main.js');
    doc.body.append(script);
    expect(runningBuild(doc)).toBeNull();
  });

  it('only asks for a refresh when both builds are known and differ', () => {
    expect(isOutdated('A', 'B')).toBe(true);
    expect(isOutdated('A', 'A')).toBe(false);
    expect(isOutdated(null, 'B')).toBe(false);
    expect(isOutdated('A', null)).toBe(false);
  });
});
