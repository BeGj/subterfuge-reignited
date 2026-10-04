import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormField, form, maxLength, minLength, pattern, required, submit } from '@angular/forms/signals';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from '@subterfuge/engine';
import { Auth, apiErrorMessage } from '../../core/auth';

type Mode = 'login' | 'register';

/** Combined login / sign-up page. */
@Component({
  imports: [FormField],
  selector: 'sub-login',
  styleUrl: './login.css',
  templateUrl: './login.html',
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly mode = signal<Mode>('login');
  protected readonly serverError = signal('');
  protected readonly submitting = signal(false);

  protected readonly title = computed(() => (this.mode() === 'login' ? 'Log in' : 'Create account'));

  protected readonly credentials = signal({ username: '', password: '' });
  protected readonly loginForm = form(this.credentials, (path) => {
    required(path.username, { message: 'Enter a username.' });
    pattern(path.username, USERNAME_PATTERN, {
      message: '3–20 characters: letters, numbers, _ or -.',
    });
    required(path.password, { message: 'Enter a password.' });
    minLength(path.password, PASSWORD_MIN_LENGTH, {
      message: `At least ${PASSWORD_MIN_LENGTH} characters.`,
    });
    maxLength(path.password, PASSWORD_MAX_LENGTH);
  });

  protected toggleMode(): void {
    this.mode.update((m) => (m === 'login' ? 'register' : 'login'));
    this.serverError.set('');
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.serverError.set('');
    void submit(this.loginForm, async () => {
      this.submitting.set(true);
      try {
        const credentials = this.credentials();
        if (this.mode() === 'login') await this.auth.login(credentials);
        else await this.auth.register(credentials);
        await this.router.navigateByUrl('/');
      } catch (err) {
        this.serverError.set(apiErrorMessage(err));
      } finally {
        this.submitting.set(false);
      }
    });
  }
}
