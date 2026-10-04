import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';
import { Realtime } from '../../core/realtime';

/** Landing page after login. Game lists will live here. */
@Component({
  selector: 'sub-lobby',
  template: `
    <header>
      <h1 class="logo">Subterfuge <span>Reignited</span></h1>
      <div class="who">
        <span>{{ auth.user()?.username }}</span>
        <button type="button" (click)="logout()">Log out</button>
      </div>
    </header>

    <main class="card">
      <h2>Lobby</h2>
      <p>Games are coming soon. For now this page shows that your session and live connection work.</p>
      <p>
        Server connection:
        <strong class="status" [class]="realtime.status()" role="status">{{ realtime.status() }}</strong>
      </p>
      @if (realtime.serverTime(); as time) {
        <p>Last server time: <code>{{ time }}</code></p>
      }
      <button type="button" (click)="realtime.ping()" [disabled]="realtime.status() !== 'connected'">
        Ping server
      </button>
    </main>
  `,
  styles: `
    :host {
      display: block;
      max-width: 720px;
      margin: 0 auto;
      padding: 16px;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .logo {
      margin: 0;
    }
    .who {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .status.connected {
      color: var(--ok);
    }
    .status.connecting,
    .status.disconnected {
      color: var(--warn);
    }
  `,
})
export class Lobby {
  protected readonly auth = inject(Auth);
  protected readonly realtime = inject(Realtime);
  private readonly router = inject(Router);

  constructor() {
    this.realtime.connect();
    inject(DestroyRef).onDestroy(() => this.realtime.disconnect());
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
