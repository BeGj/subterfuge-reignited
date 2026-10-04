import { httpResource } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
import { GAME_NAME_MAX_LENGTH, GAME_SPEEDS, MAX_PLAYERS, MIN_PLAYERS, type GameSummary } from '@subterfuge/engine';
import { Auth, apiErrorMessage } from '../../core/auth';
import { Games } from '../../core/games';
import { Realtime } from '../../core/realtime';

/** Lists games and lets players create, join, leave, start and open them. */
@Component({
  selector: 'sub-lobby',
  imports: [FormField, RouterLink],
  templateUrl: './lobby.html',
  styleUrl: './lobby.css',
})
export class Lobby {
  protected readonly auth = inject(Auth);
  protected readonly realtime = inject(Realtime);
  private readonly games = inject(Games);
  private readonly router = inject(Router);

  protected readonly speeds = GAME_SPEEDS;
  protected readonly playerCounts = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

  protected readonly list = httpResource<GameSummary[]>(() => '/api/games');
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  protected readonly myGames = computed(() => this.gamesWhere((g, mine) => mine));
  protected readonly openGames = computed(() => this.gamesWhere((g, mine) => !mine && g.status === 'lobby'));

  protected readonly newGame = signal({ name: '', maxPlayers: '4', speed: String(GAME_SPEEDS[1].speed) });
  protected readonly newGameForm = form(this.newGame, (path) => {
    required(path.name, { message: 'Give the game a name.' });
    maxLength(path.name, GAME_NAME_MAX_LENGTH);
  });

  constructor() {
    this.realtime.connect();
    const unsubscribe = this.realtime.onLobbyChanged(() => this.list.reload());
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  protected isMine(game: GameSummary): boolean {
    return game.players.some((p) => p.userId === this.auth.user()?.id);
  }

  protected isCreator(game: GameSummary): boolean {
    return game.createdBy === this.auth.user()?.username;
  }

  protected speedLabel(speed: number): string {
    return GAME_SPEEDS.find((s) => s.speed === speed)?.label ?? `${speed}×`;
  }

  protected playerNames(game: GameSummary): string {
    return game.players.map((p) => p.username).join(', ');
  }

  /** "Won by alice", or "Draw" when a finished game has no winner. */
  protected resultText(game: GameSummary): string {
    if (!game.winner) return 'Draw';
    return `Won by ${game.players.find((p) => p.playerId === game.winner)?.username ?? '—'}`;
  }

  protected onCreate(event: Event): void {
    event.preventDefault();
    void submit(this.newGameForm, async () => {
      const { name, maxPlayers, speed } = this.newGame();
      await this.run(() => this.games.create({ name: name.trim(), maxPlayers: Number(maxPlayers), speed: Number(speed) }));
      this.newGameForm().reset();
      this.newGame.update((v) => ({ ...v, name: '' }));
    });
  }

  protected join(game: GameSummary): Promise<void> {
    return this.run(() => this.games.join(game.id));
  }

  protected leave(game: GameSummary): Promise<void> {
    return this.run(() => this.games.leave(game.id));
  }

  protected start(game: GameSummary): Promise<void> {
    return this.run(() => this.games.start(game.id));
  }

  protected remove(game: GameSummary): Promise<void> {
    return this.run(() => this.games.remove(game.id));
  }

  protected async logout(): Promise<void> {
    this.realtime.disconnect();
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  /** Runs a lobby action, shows any error, and refreshes the list. */
  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await action();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
      this.list.reload();
    }
  }

  private gamesWhere(predicate: (game: GameSummary, mine: boolean) => boolean): GameSummary[] {
    if (!this.list.hasValue()) return [];
    return this.list.value().filter((g) => predicate(g, this.isMine(g)));
  }
}
