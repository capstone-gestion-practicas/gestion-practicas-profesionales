import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter
} from '@angular/router';
import { isObservable, of } from 'rxjs';

import { ContextoUsuarioResponse } from '../models/auth.models';
import { AuthService } from '../services/auth.service';
import { AuthStore } from '../store/auth.store';
import { roleGuard } from './role.guard';

describe('roleGuard', () => {
  let authService: jasmine.SpyObj<AuthService>;
  let authStore: AuthStore;

  const contexto: ContextoUsuarioResponse = {
    usuario: {
      id_usuario: 1,
      nombre: 'Usuario',
      apellido: 'Demo',
      correo: 'demo@practicalink.cl'
    },
    roles: ['ESTUDIANTE'],
    perfil: null,
    practica_actual: null
  };

  beforeEach(() => {
    authService = jasmine.createSpyObj<AuthService>(
      'AuthService',
      ['obtenerContexto']
    );

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        AuthStore,
        { provide: AuthService, useValue: authService }
      ]
    });

    authStore = TestBed.inject(AuthStore);
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function executeGuard(roles: string[]): boolean | UrlTree {
    const route = {
      data: { roles }
    } as unknown as ActivatedRouteSnapshot;

    return TestBed.runInInjectionContext(() =>
      roleGuard(
        route,
        {} as RouterStateSnapshot
      ) as boolean | UrlTree
    );
  }

  it('allows a role already present in the store', () => {
    authStore.setContexto(contexto);

    expect(executeGuard(['ESTUDIANTE'])).toBeTrue();
    expect(authService.obtenerContexto).not.toHaveBeenCalled();
  });

  it('redirects when the stored context lacks an allowed role', () => {
    authStore.setContexto(contexto);
    const result = executeGuard(['ADMINISTRADOR']) as UrlTree;
    const router = TestBed.inject(Router);

    expect(router.serializeUrl(result)).toBe('/home');
  });

  it('loads context from the API when the store is empty', (done) => {
    sessionStorage.setItem('access_token', 'test-token');
    authService.obtenerContexto.and.returnValue(of(contexto));

    const route = {
      data: { roles: ['ESTUDIANTE'] }
    } as unknown as ActivatedRouteSnapshot;

    const result = TestBed.runInInjectionContext(() =>
      roleGuard(route, {} as RouterStateSnapshot)
    );

    if (!isObservable(result)) {
      fail('Expected an observable guard result');
      done();
      return;
    }

    result.subscribe(value => {
      expect(value).toBeTrue();
      expect(authStore.obtenerContextoActual()).toEqual(contexto);
      done();
    });
  });
});
