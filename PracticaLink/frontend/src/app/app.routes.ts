import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login')
        .then(m => m.Login)
  },
  {
    path: 'home',
    canActivate: [authGuard, roleGuard],
    data: {
      roles: ['ESTUDIANTE', 'GESTOR', 'ADMINISTRADOR']
    },
    loadComponent: () =>
      import('./pages/home/home')
        .then(m => m.Home)
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
