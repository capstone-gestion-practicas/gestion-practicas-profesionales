import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { NavController } from '@ionic/angular';

import { authGuard } from '../guards/auth.guard';
import { ContextoUsuarioResponse } from '../models/auth.models';
import { AuthStore } from '../store/auth.store';
import { SesionService } from './sesion.service';

describe('SesionService (cierre de sesión centralizado)', () => {
  let navController: jasmine.SpyObj<NavController>;
  let authStore: AuthStore;

  const contexto: ContextoUsuarioResponse = {
    usuario: { id_usuario: 1, nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.test' },
    roles: ['ESTUDIANTE'],
    perfil: null,
    practica_actual: null
  };

  beforeEach(() => {
    navController = jasmine.createSpyObj<NavController>('NavController', ['navigateRoot']);
    navController.navigateRoot.and.returnValue(Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: NavController, useValue: navController }]
    });
    authStore = TestBed.inject(AuthStore);
    sessionStorage.setItem('access_token', 'sintetico');
    authStore.setContexto(contexto);
  });

  afterEach(() => sessionStorage.clear());

  it('elimina el token y limpia el estado de autenticación', () => {
    TestBed.inject(SesionService).cerrar();
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(authStore.obtenerContextoActual()).toBeNull();
  });

  it('navega a la raíz del Login con navegación raíz de Ionic', () => {
    TestBed.inject(SesionService).cerrar();
    expect(navController.navigateRoot).toHaveBeenCalledOnceWith(['/login']);
  });

  it('después del cierre, un guard protegido redirige al Login sin token', () => {
    TestBed.inject(SesionService).cerrar();
    const resultado = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );
    expect(resultado instanceof UrlTree).toBeTrue();
    expect(TestBed.inject(Router).serializeUrl(resultado as UrlTree)).toBe('/login');
  });
});
