import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Realtime } from './core/realtime';

@Component({
  imports: [RouterOutlet],
  selector: 'sub-root',
  template: `
    @if (realtime.updateAvailable()) {
      <div class="update" role="alert">
        <span>The game has been updated. Refresh to load the new version.</span>
        <button type="button" class="primary" (click)="reload()">Refresh</button>
      </div>
    }
    <router-outlet />
  `,
  styles: `
    .update {
      position: fixed;
      z-index: 1000;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 12px;
      align-items: center;
      max-width: calc(100vw - 32px);
      padding: 10px 14px;
      border: 1px solid var(--warn);
      border-radius: var(--radius);
      background: var(--surface-2);
      box-shadow: 0 6px 24px rgb(0 0 0 / 0.5);
    }
  `,
})
export class App {
  protected readonly realtime = inject(Realtime);

  protected reload(): void {
    location.reload();
  }
}
