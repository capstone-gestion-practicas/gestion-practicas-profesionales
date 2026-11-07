import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { studentHomeSpaceGuard } from './core/guards/student-home-space.guard';
import { ESPACIO_PAGINA } from './core/navigation/espacio-pagina.token';
import { AuthStore } from './core/store/auth.store';
import { AuthService } from './core/services/auth.service';
import { aplanarRutas } from './app.routes.testing';

describe('Practice consultation routing', () => {
  it('preserves existing routes and protects the new route', () => {
    for (const path of ['', 'login', 'home', 'usuarios', 'revisiones', 'revisiones/:id', 'practicas', 'practicas/:id', '**']) {
      expect(aplanarRutas(routes).some(route => route.path === path)).toBeTrue();
    }
    const route = aplanarRutas(routes).find(route => route.path === 'practicas' && route.data?.['roles']?.includes('GESTOR'))!;
    const detalle = aplanarRutas(routes).find(route => route.path === 'practicas/:id' && route.data?.['roles']?.includes('GESTOR'))!;
    expect(detalle.canActivate).toEqual([authGuard, roleGuard]);
    expect(detalle.data?.['roles']).toEqual(['GESTOR', 'ADMINISTRADOR']);
    expect(route.canActivate).toEqual([authGuard, roleGuard]);
    expect(route.data?.['roles']).toEqual(['GESTOR', 'ADMINISTRADOR']);
    expect(routes[routes.length - 1].path).toBe('**');
    expect(aplanarRutas(routes).find(route => route.path === 'revisiones')?.data?.['roles']).toEqual(['GESTOR']);
  });

  it('protects the docente workspace and its assigned practice views', () => {
    const docente = routes.find(route => route.path === 'docente')!;
    expect(docente.data?.['roles']).toEqual(['DOCENTE']);
    expect(docente.children?.map(route => route.path)).toContain('practicas');
    expect(docente.children?.filter(route => route.path?.startsWith('practicas')).every(route => route.data?.['roles']?.includes('DOCENTE'))).toBeTrue();
    expect(aplanarRutas(routes).find(route => route.path === 'espacios')?.data?.['roles'])
      .toEqual(['ESTUDIANTE', 'GESTOR', 'DOCENTE', 'ADMINISTRADOR']);
  });

  it('protects the nested student space and preserves compatible legacy routes', () => {
    const student = aplanarRutas(routes).find(route => route.path === 'estudiante')!;
    expect(student.canActivate).toEqual([authGuard, roleGuard]);
    expect(student.data?.['roles']).toEqual(['ESTUDIANTE']);
    expect(student.children?.map(route => route.path)).toEqual(['', 'inicio', 'mi-practica', 'notificaciones', 'perfil']);
    for (const child of student.children?.filter(route => route.path) ?? []) {
      expect(child.canActivate).toEqual([authGuard, roleGuard]);
      expect(child.data?.['roles']).toEqual(['ESTUDIANTE']);
    }
    expect(aplanarRutas(routes).find(route => route.path === 'home')?.canActivate)
      .toEqual([authGuard, roleGuard, studentHomeSpaceGuard]);
    expect(routes.find(route => route.path === '' && route.children !== undefined)!.children!.find(route => route.path === 'notificaciones')?.data?.['roles'])
      .toEqual(['ESTUDIANTE', 'GESTOR', 'ADMINISTRADOR']);
  });

  it('allows gestor and administrador and redirects estudiante', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), AuthStore,
      { provide: AuthService, useValue: jasmine.createSpyObj('AuthService', ['obtenerContexto']) }]
    });
    for (const path of ['practicas', 'practicas/:id']) {
    const route = aplanarRutas(routes).find(route => route.path === path && route.data?.['roles']?.includes('GESTOR'))!;
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
    }
  });

  it('allows direct /home navigation for every supported single and multiple role context', () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        AuthStore,
        { provide: AuthService, useValue: jasmine.createSpyObj('AuthService', ['obtenerContexto']) }
      ]
    });
    const route = aplanarRutas(routes).find(item => item.path === 'home')!;
    const roleSets = [
      ['ESTUDIANTE'],
      ['GESTOR'],
      ['ADMINISTRADOR'],
      ['ESTUDIANTE', 'GESTOR'],
      ['ESTUDIANTE', 'ADMINISTRADOR']
    ];

    for (const roles of roleSets) {
      TestBed.inject(AuthStore).setContexto({
        usuario: { id_usuario: 1, nombre: 'Sintético', apellido: 'Prueba', correo: 'test@example.com' },
        roles,
        perfil: null,
        practica_actual: null
      });
      const result = TestBed.runInInjectionContext(() => roleGuard(
        { data: route.data } as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot
      ));
      expect(result).toBeTrue();
    }
  });

  it('restricts review to gestores and preserves administrator access to practice management', () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        AuthStore,
        { provide: AuthService, useValue: jasmine.createSpyObj('AuthService', ['obtenerContexto']) }
      ]
    });
    const rutasGestion = [
      { path: 'practicas', rolesPermitidos: ['GESTOR', 'ADMINISTRADOR'] },
      { path: 'revisiones', rolesPermitidos: ['GESTOR'] },
      { path: 'revisiones/:id', rolesPermitidos: ['GESTOR'] }
    ];
    const roleSets = [
      { roles: ['ESTUDIANTE'], puedeGestionarPracticas: false, puedeRevisar: false },
      { roles: ['GESTOR'], puedeGestionarPracticas: true, puedeRevisar: true },
      { roles: ['ADMINISTRADOR'], puedeGestionarPracticas: true, puedeRevisar: false },
      { roles: ['ESTUDIANTE', 'GESTOR'], puedeGestionarPracticas: true, puedeRevisar: true },
      { roles: ['ESTUDIANTE', 'ADMINISTRADOR'], puedeGestionarPracticas: true, puedeRevisar: false },
      { roles: ['ADMINISTRADOR', 'GESTOR'], puedeGestionarPracticas: true, puedeRevisar: true }
    ];

    for (const politica of rutasGestion) {
      const route = aplanarRutas(routes).find(item => item.path === politica.path && item.data?.['roles']?.includes('GESTOR'))!;
      expect(route.canActivate).toEqual([authGuard, roleGuard]);
      expect(route.data?.['roles']).toEqual(politica.rolesPermitidos);
      for (const caso of roleSets) {
        TestBed.inject(AuthStore).setContexto({
          usuario: { id_usuario: 1, nombre: 'Sintético', apellido: 'Prueba', correo: 'test@example.com' },
          roles: caso.roles,
          perfil: null,
          practica_actual: null
        });
        const result = TestBed.runInInjectionContext(() => roleGuard(
          { data: route.data } as ActivatedRouteSnapshot,
          {} as RouterStateSnapshot
        ));
        const autorizado = politica.path === 'practicas'
          ? caso.puedeGestionarPracticas
          : caso.puedeRevisar;
        if (autorizado) {
          expect(result).toBeTrue();
        } else {
          expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/home');
        }
      }
    }
  });

  it('provides the student presentation only to the nested student notifications route', () => {
    const estudiante = aplanarRutas(routes).find(route => route.path === 'estudiante')!;
    const notificacionesEstudiante = estudiante.children!.find(route => route.path === 'notificaciones')!;
    const notificacionesOriginal = routes.find(route => route.path === '' && route.children !== undefined)!.children!.find(route => route.path === 'notificaciones')!;

    expect(notificacionesEstudiante.providers).toEqual([{ provide: ESPACIO_PAGINA, useValue: 'estudiante' }]);
    expect(notificacionesOriginal.providers).toBeUndefined();
  });
});
