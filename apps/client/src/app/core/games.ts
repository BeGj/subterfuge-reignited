import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CreateGameRequest, GameSummary } from '@subterfuge/engine';

/** Lobby mutations over HTTP. Reads use `httpResource` in the components. */
@Service()
export class Games {
  private readonly http = inject(HttpClient);

  create(request: CreateGameRequest): Promise<GameSummary> {
    return firstValueFrom(this.http.post<GameSummary>('/api/games', request));
  }

  join(id: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/games/${id}/join`, null));
  }

  leave(id: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/games/${id}/leave`, null));
  }

  start(id: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/games/${id}/start`, null));
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/games/${id}`));
  }
}
