import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';

import { AuthStore } from '../store/auth.store';
import { studentHomeSpaceGuard } from './student-home-space.guard';

describe('studentHomeSpaceGuard', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([]), AuthStore] }));

  it('redirige al inicio V3 a estudiantes exclusivos', () => {
    TestBed.inject(AuthStore).setContexto({
      usuario: { id_usuario: 1, nombre: 'Ana', apellido: 'Estudiante', correo: 'a@example.test' },
      roles: ['ESTUDIANTE'], perfil: null, practica_actual: null
    });
    const result = TestBed.runInInjectionContext(() => studentHomeSpaceGuard(
      {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot
    ));
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/estudiante/inicio');
  });

  it('conserva /home para gestor, administrador y usuarios con múltiples roles', () => {
    const store = TestBed.inject(AuthStore);
    for (const roles of [['GESTOR'], ['ADMINISTRADOR'], ['ESTUDIANTE', 'GESTOR'], ['ESTUDIANTE', 'ADMINISTRADOR']]) {
      store.setContexto({
        usuario: { id_usuario: 1, nombre: 'Cuenta', apellido: 'Prueba', correo: 'a@example.test' },
        roles, perfil: null, practica_actual: null
      });
      expect(TestBed.runInInjectionContext(() => studentHomeSpaceGuard(
        {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot
      ))).toBeTrue();
    }
  });
});
