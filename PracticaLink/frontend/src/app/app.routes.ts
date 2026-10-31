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
    path: 'notificaciones',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['ESTUDIANTE', 'GESTOR', 'ADMINISTRADOR'] },
    loadComponent: () =>
      import('./features/notificaciones/pages/notificaciones/notificaciones')
        .then(m => m.Notificaciones)
  },
  {
    path: 'envio-notificaciones',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['GESTOR', 'ADMINISTRADOR'] },
    loadComponent: () =>
      import('./features/notificaciones/pages/envio-notificaciones/envio-notificaciones')
        .then(m => m.EnvioNotificaciones)
  },
  {
    path: 'usuarios',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['ADMINISTRADOR'] },
    loadComponent: () =>
      import('./pages/usuarios/usuarios').then(m => m.Usuarios)
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
    path: 'gestion-estados',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['GESTOR', 'ADMINISTRADOR'] },
    loadComponent: () =>
      import('./pages/gestion-estados/gestion-estados')
        .then(m => m.GestionEstados)
  },
  {
    path: 'seguimientos',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['GESTOR', 'ADMINISTRADOR'] },
    loadComponent: () =>
      import('./pages/seguimientos/seguimientos').then(m => m.Seguimientos)
  },
  {
    path: 'incidencias',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['GESTOR', 'ADMINISTRADOR'] },
    loadComponent: () =>
      import('./pages/incidencias/incidencias').then(m => m.Incidencias)
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
