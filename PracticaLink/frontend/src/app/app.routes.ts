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
    path: 'practicas/nueva',
    canActivate: [authGuard, roleGuard],
    data: {
      roles: ['ESTUDIANTE']
    },
    loadComponent: () =>
      import('./pages/practica-form/practica-form')
        .then(m => m.PracticaForm)
  },
  {
    path: 'revisiones',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['GESTOR', 'ADMINISTRADOR'] },
    loadComponent: () =>
      import('./pages/revisiones/revisiones').then(m => m.Revisiones)
  },
  {
    path: 'revisiones/:id',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['GESTOR', 'ADMINISTRADOR'] },
    loadComponent: () =>
      import('./pages/revision-detalle/revision-detalle')
        .then(m => m.RevisionDetalle)
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
