import type { OrderInput } from '@subterfuge/engine';

/**
 * Structural check for orders arriving over Socket.IO. Payloads are
 * untrusted, so check every field's type before the engine sees it. The
 * engine's `validateOrder` then checks the game rules.
 */
export function parseOrderInput(value: unknown): OrderInput | string {
  if (typeof value !== 'object' || value === null) return 'Order must be an object.';
  const o = value as Record<string, unknown>;
  const isId = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 64;
  const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000;

  switch (o['kind']) {
    case 'launch': {
      const specialists = o['specialists'] ?? [];
      if (!isId(o['from']) || !isId(o['to'])) return 'Launch needs `from` and `to` outpost ids.';
      if (!isCount(o['drillers'])) return '`drillers` must be a non-negative integer.';
      if (!Array.isArray(specialists) || specialists.length > 50 || !specialists.every(isId)) {
        return '`specialists` must be a list of ids.';
      }
      if (o['isGift'] !== undefined && typeof o['isGift'] !== 'boolean') return '`isGift` must be a boolean.';
      return {
        kind: 'launch',
        from: o['from'] as string,
        to: o['to'] as string,
        drillers: o['drillers'] as number,
        specialists: [...(specialists as string[])],
        ...(o['isGift'] ? { isGift: true } : {}),
      };
    }
    case 'drillMine':
      if (!isId(o['outpost'])) return 'drillMine needs an `outpost` id.';
      return { kind: 'drillMine', outpost: o['outpost'] as string };
    case 'setShield':
      if (!isId(o['outpost']) || typeof o['enabled'] !== 'boolean') {
        return 'setShield needs an `outpost` id and `enabled` boolean.';
      }
      return { kind: 'setShield', outpost: o['outpost'] as string, enabled: o['enabled'] as boolean };
    case 'resign':
      return { kind: 'resign' };
    default:
      return 'Unknown order kind.';
  }
}
