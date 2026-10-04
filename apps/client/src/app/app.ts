import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Realtime } from './core/realtime';

@Component({
  imports: [RouterOutlet],
  selector: 'sub-root',
  host: {
    // Browsers throttle background tabs and drop sockets on network changes;
    // reconnect as soon as the page is visible or online again.
    '(document:visibilitychange)': 'realtime.nudge()',
    '(window:online)': 'realtime.nudge()',
  },
  template: `
    @if (realtime.sessionExpired()) {
      <div class="update" role="alert">
        <span>Your session has ended. Please log in again.</span>
        <button type="button" class="primary" (click)="goToLogin()">Log in</button>
      </div>
    } @else if (realtime.updateAvailable()) {
      <div class="update" role="alert">
        <span>The game has been updated. Refresh to load the new version.</span>
        <button type="button" class="primary" (click)="reload()">Refresh</button>
      </div>
    } @else if (realtime.stuck()) {
      <div class="update" role="alert">
        <span>Can't reach the server. Still trying to reconnect…</span>
        <button type="button" class="primary" (click)="reload()">Reload page</button>
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

  protected goToLogin(): void {
    // A full load resets the cached session state in Auth.
    location.assign('/login');
  }
}
