import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Log in · Subterfuge Reignited',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: '',
    title: 'Lobby · Subterfuge Reignited',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/lobby/lobby').then((m) => m.Lobby),
  },
  {
    path: 'games/:id',
    title: 'Game · Subterfuge Reignited',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/game/game').then((m) => m.Game),
  },
  { path: '**', redirectTo: '' },
];
