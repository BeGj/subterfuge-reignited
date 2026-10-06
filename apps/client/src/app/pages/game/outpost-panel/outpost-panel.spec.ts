import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { generateMap, viewFor, type GameSnapshot, type GameState, type PlayerView } from '@subterfuge/engine';
import { Realtime } from '../../../core/realtime';
import { TimeMachine } from '../time-machine';
import { OutpostPanel } from './outpost-panel';

/** p1's Queen outpost with a Lieutenant beside her, and the launch form open. */
function setup() {
  const state: GameState = generateMap({ seed: 7, players: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] });
  const queen = state.specialists.find((s) => s.kind === 'queen' && s.owner === 'p1')!;
  state.specialists.push({ id: 'lt', kind: 'lieutenant', owner: 'p1', location: queen.location, captiveOf: null });
  const view = viewFor(state, 'p1');
  const home = 'outpost' in queen.location ? queen.location.outpost : '';
  const target = view.outposts.find((o) => o.owner === 'p2')!;
  const snapshot = signal<GameSnapshot | null>({
    gameId: 'g',
    view,
    pendingOrders: [],
    clock: { startedAt: new Date(0).toISOString(), speed: 60, serverNow: new Date(0).toISOString() },
    events: [],
    imminentLaunches: [],
  });

  TestBed.configureTestingModule({
    imports: [OutpostPanel],
    providers: [TimeMachine, { provide: Realtime, useValue: {} }],
  });
  TestBed.inject(TimeMachine).bind(snapshot, signal(0));
  const fixture = TestBed.createComponent(OutpostPanel);
  const show = (v: PlayerView) => {
    fixture.componentRef.setInput('view', v);
    fixture.componentRef.setInput('outpost', v.outposts.find((o) => o.id === home)!);
    fixture.detectChanges();
  };
  fixture.componentRef.setInput('gameId', 'g');
  fixture.componentRef.setInput('minute', 0);
  fixture.componentRef.setInput('launching', true);
  fixture.componentRef.setInput('launchTargetId', target.id);
  show(view);
  return { fixture, view, show };
}

const checkboxes = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
const tripLine = (root: HTMLElement) => root.querySelector('form')!.textContent!.split('·')[1]!.trim();

describe('OutpostPanel launch form', () => {
  it('keeps the specialists you ticked when a server update arrives', () => {
    const { fixture, view, show } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const before = tripLine(root);
    const lieutenant = checkboxes(root).find((c) => c.closest('label')!.textContent!.includes('Lieutenant'))!;
    lieutenant.click();
    fixture.detectChanges();
    const faster = tripLine(root);
    expect(faster).not.toBe(before); // 1.5× speed

    // The next update: the same game, a new view object.
    show(structuredClone(view));
    expect(checkboxes(root).find((c) => c.closest('label')!.textContent!.includes('Lieutenant'))!.checked).toBe(true);
    expect(tripLine(root)).toBe(faster);
  });
});
