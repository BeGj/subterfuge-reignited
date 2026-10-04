import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { Auth } from './auth';

// Note: inject() only works synchronously, so resolve dependencies before
// the first `await`.

/** Only logged-in players may enter; everyone else goes to /login. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ensureSessionChecked();
  return auth.isLoggedIn() || router.parseUrl('/login');
};

/** Keeps logged-in players away from the login page. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ensureSessionChecked();
  return !auth.isLoggedIn() || router.parseUrl('/');
};
