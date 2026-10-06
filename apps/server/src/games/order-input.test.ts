import { describe, expect, it } from 'vitest';
import { parseOrderInput } from './order-input.ts';

describe('parseOrderInput', () => {
  it('accepts well-formed orders and drops unknown fields', () => {
    expect(
      parseOrderInput({ kind: 'launch', from: 'o-1', to: 'o-2', drillers: 5, specialists: ['spec-1'], at: 0, player: 'p9' }),
    ).toEqual({ kind: 'launch', from: 'o-1', to: 'o-2', drillers: 5, specialists: ['spec-1'] });
    expect(parseOrderInput({ kind: 'launch', from: 'o-1', to: 'o-2', drillers: 0, isGift: true })).toEqual({
      kind: 'launch',
      from: 'o-1',
      to: 'o-2',
      drillers: 0,
      specialists: [],
      isGift: true,
    });
    expect(parseOrderInput({ kind: 'drillMine', outpost: 'o-1' })).toEqual({ kind: 'drillMine', outpost: 'o-1' });
    expect(parseOrderInput({ kind: 'resign', player: 'p2' })).toEqual({ kind: 'resign' });
    expect(parseOrderInput({ kind: 'voteEnd', agree: true })).toEqual({ kind: 'voteEnd', agree: true });
    expect(typeof parseOrderInput({ kind: 'voteEnd', agree: 'yes' })).toBe('string');
    expect(parseOrderInput({ kind: 'setShield', outpost: 'o-1', enabled: false })).toEqual({
      kind: 'setShield',
      outpost: 'o-1',
      enabled: false,
    });
  });

  it.each([
    ['null', null],
    ['unknown kind', { kind: 'nuke' }],
    ['missing target', { kind: 'launch', from: 'o-1', drillers: 1 }],
    ['negative drillers', { kind: 'launch', from: 'o-1', to: 'o-2', drillers: -1 }],
    ['fractional drillers', { kind: 'launch', from: 'o-1', to: 'o-2', drillers: 1.5 }],
    ['string drillers', { kind: 'launch', from: 'o-1', to: 'o-2', drillers: '5' }],
    ['bad specialists', { kind: 'launch', from: 'o-1', to: 'o-2', drillers: 1, specialists: [1] }],
    ['bad gift flag', { kind: 'launch', from: 'o-1', to: 'o-2', drillers: 1, isGift: 'yes' }],
    ['shield without flag', { kind: 'setShield', outpost: 'o-1' }],
    ['huge id', { kind: 'drillMine', outpost: 'x'.repeat(65) }],
  ])('rejects %s', (_name, input) => {
    expect(typeof parseOrderInput(input)).toBe('string');
  });
});

describe('parseOrderInput with hostile payloads', () => {
  it('never lets client-chosen `at`/`player` or extra fields through', () => {
    const parsed = parseOrderInput({
      kind: 'drillMine',
      outpost: 'o-1',
      at: 0,
      player: 'p2',
      admin: true,
    });
    expect(parsed).toEqual({ kind: 'drillMine', outpost: 'o-1' });
  });

  it('ignores prototype-pollution keys and does not pollute Object.prototype', () => {
    const payload = JSON.parse('{"kind":"resign","__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}');
    expect(parseOrderInput(payload)).toEqual({ kind: 'resign' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it.each([
    ['array instead of object', ['launch']],
    ['string', 'launch'],
    ['number', 42],
    ['kind as object', { kind: { toString: (): string => 'launch' } }],
    ['ids as objects', { kind: 'launch', from: { id: 'o-1' }, to: 'o-2', drillers: 1 }],
    ['ids as numbers', { kind: 'drillMine', outpost: 7 }],
    ['empty id', { kind: 'drillMine', outpost: '' }],
    ['NaN drillers', { kind: 'launch', from: 'o-1', to: 'o-2', drillers: Number.NaN }],
    ['Infinity drillers', { kind: 'launch', from: 'o-1', to: 'o-2', drillers: Number.POSITIVE_INFINITY }],
    ['absurd drillers', { kind: 'launch', from: 'o-1', to: 'o-2', drillers: 1e12 }],
    ['specialists as object', { kind: 'launch', from: 'o-1', to: 'o-2', drillers: 1, specialists: { 0: 'spec-1' } }],
    ['too many specialists', { kind: 'launch', from: 'o-1', to: 'o-2', drillers: 1, specialists: Array(51).fill('s') }],
    ['shield enabled as string', { kind: 'setShield', outpost: 'o-1', enabled: 'false' }],
    ['unknown specialist', { kind: 'hire', choice: 'martyr' }],
    ['hire choice as object', { kind: 'hire', choice: { kind: 'princess' } }],
    ['hire choice from the prototype', { kind: 'hire', choice: 'toString' }],
    ['promote without specialist', { kind: 'promote' }],
    ['promote specialist as number', { kind: 'promote', specialist: 3 }],
    ['redirect without target', { kind: 'redirect', sub: 'sub-1' }],
    ['redirect sub as object', { kind: 'redirect', sub: {}, to: 'o-2' }],
  ])('rejects %s', (_name, input) => {
    expect(typeof parseOrderInput(input)).toBe('string');
  });

  it.each([
    ['hire', { kind: 'hire', choice: 'lieutenant' }, { kind: 'hire', choice: 'lieutenant' }],
    ['promote', { kind: 'promote', specialist: 'spec-7' }, { kind: 'promote', specialist: 'spec-7' }],
    [
      'redirect',
      { kind: 'redirect', sub: 'sub-1', to: 'o-9' },
      { kind: 'redirect', sub: 'sub-1', to: 'o-9' },
    ],
  ])('parses %s', (_name, input, expected) => {
    expect(parseOrderInput(input)).toEqual(expected);
  });

  it('returns plain data (no references to the input)', () => {
    const specialists = ['spec-1'];
    const parsed = parseOrderInput({ kind: 'launch', from: 'o-1', to: 'o-2', drillers: 1, specialists });
    specialists.push('spec-2');
    expect(parsed).toMatchObject({ specialists: ['spec-1'] });
  });
});
