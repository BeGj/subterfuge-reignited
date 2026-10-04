/**
 * What the player has selected on the map or in the sidebar. One thing at a
 * time: an outpost, a sub in flight, one of your pending orders, or a
 * predicted battle (id = the prediction key, see TimeMachine).
 */
export type Selection =
  | { kind: 'outpost'; id: string }
  | { kind: 'sub'; id: string }
  | { kind: 'order'; id: string }
  | { kind: 'battle'; id: string };

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
}

export function isSelected(selection: Selection | null, kind: Selection['kind'], id: string): boolean {
  return selection?.kind === kind && selection.id === id;
}
