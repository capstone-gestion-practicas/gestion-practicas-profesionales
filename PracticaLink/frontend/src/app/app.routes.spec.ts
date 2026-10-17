import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { AuthStore } from './core/store/auth.store';
import { AuthService } from './core/services/auth.service';

describe('Practice consultation routing', () => {
  it('preserves existing routes and protects the new route', () => {
    for (const path of ['', 'login', 'home', 'usuarios', 'revisiones', 'revisiones/:id', '**']) {
      expect(routes.some(route => route.path === path)).toBeTrue();
    }
    const route = routes.find(route => route.path === 'practicas')!;
    expect(route.canActivate).toEqual([authGuard, roleGuard]);
    expect(route.data?.['roles']).toEqual(['GESTOR', 'ADMINISTRADOR']);
    expect(routes[routes.length - 1].path).toBe('**');
    expect(routes.find(route => route.path === 'revisiones')?.data?.['roles']).toEqual(['GESTOR', 'ADMINISTRADOR']);
  });

  it('allows gestor and administrador and redirects estudiante', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), AuthStore,
      { provide: AuthService, useValue: jasmine.createSpyObj('AuthService', ['obtenerContexto']) }]
    });
    const route = routes.find(route => route.path === 'practicas')!;
    for (const rol of ['GESTOR', 'ADMINISTRADOR', 'ESTUDIANTE']) {
      TestBed.inject(AuthStore).setContexto({
        usuario: { id_usuario: 1, nombre: 'Sintético', apellido: 'Prueba', correo: 'test@example.com' },
        roles: [rol], perfil: null, practica_actual: null
      });
      const result = TestBed.runInInjectionContext(() => roleGuard(
        { data: route.data } as ActivatedRouteSnapshot, {} as RouterStateSnapshot
      ));
      if (rol === 'ESTUDIANTE') {
        expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/home');
      } else { expect(result).toBeTrue(); }
    }
  });
});
