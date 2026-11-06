import { Route } from '@angular/router';

import { routes } from '../../../app.routes';
import { authGuard } from '../../../core/guards/auth.guard';
import { roleGuard } from '../../../core/guards/role.guard';
import { studentHomeSpaceGuard } from '../../../core/guards/student-home-space.guard';

describe('Rutas del gestor bajo GestorLayout', () => {
  const contenedor = routes.find(ruta => ruta.path === '' && ruta.children !== undefined) as Route;
  const hijos = contenedor.children ?? [];

  it('conserva exactamente las URL de gestión existentes, incluido /home', () => {
    expect(hijos.map(ruta => ruta.path)).toEqual([
      'home',
      'notificaciones',
      'envio-notificaciones',
      'revisiones',
      'revisiones/:id',
      'gestion-estados',
      'seguimientos',
      'incidencias',
      'practicas',
      'practicas/:id/seguimiento/nuevo',
      'practicas/:id/incidencias/nueva',
      'practicas/:id'
    ]);
  });

  it('mantiene el guard de autenticación y de rol en cada hijo', () => {
    for (const hijo of hijos) {
      expect(hijo.canActivate).toContain(authGuard);
      expect(hijo.canActivate).toContain(roleGuard);
    }
  });

  it('home conserva el guard de espacio de estudiante y sus roles originales', () => {
    const home = hijos.find(hijo => hijo.path === 'home');
    expect(home?.canActivate).toEqual([authGuard, roleGuard, studentHomeSpaceGuard]);
    expect(home?.data?.['roles']).toEqual(['ESTUDIANTE', 'GESTOR', 'ADMINISTRADOR']);
  });

  it('conserva los roles originales de cada módulo', () => {
    const roles = (ruta: string): unknown => hijos.find(hijo => hijo.path === ruta)?.data?.['roles'];
    expect(roles('notificaciones')).toEqual(['ESTUDIANTE', 'GESTOR', 'ADMINISTRADOR']);
    expect(roles('envio-notificaciones')).toEqual(['GESTOR', 'ADMINISTRADOR']);
    expect(roles('revisiones/:id')).toEqual(['GESTOR', 'ADMINISTRADOR']);
    expect(roles('practicas/:id')).toEqual(['GESTOR', 'ADMINISTRADOR']);
  });

  it('deja fuera del layout a usuarios, login y estudiante', () => {
    const topLevel = routes.map(ruta => ruta.path);
    expect(topLevel).toEqual(jasmine.arrayContaining(['estudiante', 'login', 'usuarios']));
    expect(topLevel).not.toContain('home');
    expect(hijos.map(ruta => ruta.path)).not.toContain('usuarios');
    expect(hijos.map(ruta => ruta.path)).not.toContain('estudiante');
  });

  it('mantiene el comodín final como última ruta', () => {
    expect(routes[routes.length - 1].path).toBe('**');
  });
});
