import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { studentHomeSpaceGuard } from './core/guards/student-home-space.guard';
import { ESPACIO_PAGINA } from './core/navigation/espacio-pagina.token';

export const routes: Routes = [
  {
    path: 'estudiante',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['ESTUDIANTE'] },
    loadComponent: () =>
      import('./features/estudiante/layout/student-layout').then(m => m.StudentLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      {
        path: 'inicio', canActivate: [authGuard, roleGuard], data: { roles: ['ESTUDIANTE'] },
        loadComponent: () => import('./features/estudiante/home/student-home').then(m => m.StudentHome)
      },
      {
        path: 'mi-practica', canActivate: [authGuard, roleGuard], data: { roles: ['ESTUDIANTE'] },
        loadComponent: () => import('./features/estudiante/practice/student-practice').then(m => m.StudentPractice)
      },
      {
        path: 'notificaciones', canActivate: [authGuard, roleGuard], data: { roles: ['ESTUDIANTE'] },
        providers: [{ provide: ESPACIO_PAGINA, useValue: 'estudiante' }],
        loadComponent: () => import('./features/notificaciones/pages/notificaciones/notificaciones').then(m => m.Notificaciones)
      },
      {
        path: 'perfil', canActivate: [authGuard, roleGuard], data: { roles: ['ESTUDIANTE'] },
        loadComponent: () => import('./features/estudiante/profile/student-profile').then(m => m.StudentProfile)
      }
    ]
  },
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
    path: 'usuarios',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['ADMINISTRADOR'] },
    loadComponent: () =>
      import('./pages/usuarios/usuarios').then(m => m.Usuarios)
  },
  /*
   * Módulos de gestión. Las rutas hijas conservan sus URL exactas; el contenedor
   * GestorLayout muestra la cabecera persistente solo al gestor sin administración.
   * Cada hijo mantiene sus guards y roles originales.
   */
  {
    path: '',
    loadComponent: () =>
      import('./features/gestor/layout/gestor-layout').then(m => m.GestorLayout),
    children: [
      {
        path: 'home',
        canActivate: [authGuard, roleGuard, studentHomeSpaceGuard],
        data: { roles: ['ESTUDIANTE', 'GESTOR', 'ADMINISTRADOR'] },
        loadComponent: () =>
          import('./pages/home/home').then(m => m.Home)
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
        path: 'revisiones',
        canActivate: [authGuard, roleGuard],
        data: { roles: ['GESTOR'] },
        loadComponent: () =>
          import('./pages/revisiones/revisiones').then(m => m.Revisiones)
      },
      {
        path: 'revisiones/:id',
        canActivate: [authGuard, roleGuard],
        data: { roles: ['GESTOR'] },
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
        path: 'practicas',
        canActivate: [authGuard, roleGuard],
        data: { roles: ['GESTOR', 'ADMINISTRADOR'] },
        loadComponent: () =>
          import('./pages/practicas-listado/practicas-listado').then(m => m.PracticasListado)
      },
      {
        path: 'practicas/:id/seguimiento/nuevo',
        canActivate: [authGuard, roleGuard],
        data: { roles: ['GESTOR', 'ADMINISTRADOR'], tipoRegistro: 'seguimiento' },
        loadComponent: () =>
          import('./pages/registro-practica/registro-practica').then(m => m.RegistroPractica)
      },
      {
        path: 'practicas/:id/incidencias/nueva',
        canActivate: [authGuard, roleGuard],
        data: { roles: ['GESTOR', 'ADMINISTRADOR'], tipoRegistro: 'incidencia' },
        loadComponent: () =>
          import('./pages/registro-practica/registro-practica').then(m => m.RegistroPractica)
      },
      {
        path: 'practicas/:id',
        canActivate: [authGuard, roleGuard],
        data: { roles: ['GESTOR', 'ADMINISTRADOR'] },
        loadComponent: () =>
          import('./pages/practica-detalle/practica-detalle').then(m => m.PracticaDetalle)
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
