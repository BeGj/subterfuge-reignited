import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiError, AuthCredentials, PublicUser, RegisterRequest, RegistrationInfo } from '@subterfuge/engine';

/**
 * Session state for the current browser. The session itself lives in an
 * httpOnly cookie set by the server; this service only mirrors who is
 * logged in. See docs/auth.md.
 */
@Service()
export class Auth {
  private readonly http = inject(HttpClient);

  private readonly currentUser = signal<PublicUser | undefined>(undefined);
  private sessionChecked: Promise<void> | undefined;

  readonly user = this.currentUser.asReadonly();
  readonly isLoggedIn = computed(() => this.currentUser() !== undefined);

  /** Asks the server who we are, once per page load. */
  ensureSessionChecked(): Promise<void> {
    this.sessionChecked ??= firstValueFrom(this.http.get<PublicUser>('/api/auth/me')).then(
      (user) => this.currentUser.set(user),
      () => this.currentUser.set(undefined),
    );
    return this.sessionChecked;
  }

  login(credentials: AuthCredentials): Promise<void> {
    return this.authenticate('/api/auth/login', credentials);
  }

  register(request: RegisterRequest): Promise<void> {
    return this.authenticate('/api/auth/register', request);
  }

  /** Whether sign-up needs an invite code on this server. */
  registrationInfo(): Promise<RegistrationInfo> {
    return firstValueFrom(this.http.get<RegistrationInfo>('/api/auth/registration'));
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', null));
    this.currentUser.set(undefined);
  }

  private async authenticate(url: string, credentials: AuthCredentials | RegisterRequest): Promise<void> {
    const user = await firstValueFrom(this.http.post<PublicUser>(url, credentials));
    this.currentUser.set(user);
  }
}

/** Turns a failed API call into a message fit to show the user. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as Partial<ApiError> | null;
    if (typeof body?.error === 'string' && err.status !== 400) return body.error;
    if (err.status === 0) return 'Cannot reach the server.';
  }
  return 'Something went wrong. Please try again.';
}
