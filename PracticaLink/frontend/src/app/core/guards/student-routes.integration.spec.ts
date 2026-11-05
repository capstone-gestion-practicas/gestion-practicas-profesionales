import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet, Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import { authGuard } from './auth.guard';
import { roleGuard } from './role.guard';

@Component({ selector: 'test-student-routes-shell', standalone: true, imports: [RouterOutlet], template: '<router-outlet />' })
class StudentRoutesShell {}

@Component({ selector: 'test-student-route-page', standalone: true, template: 'student-child' })
class StudentRoutePage {}

@Component({ selector: 'test-management-home-page', standalone: true, template: 'management-home' })
class ManagementHomePage {}

@Component({ selector: 'test-login-page', standalone: true, template: 'login-page' })
class LoginPage {}

const routes: Routes = [
  {
    path: 'estudiante', component: StudentRoutesShell,
    canActivate: [authGuard, roleGuard], data: { roles: ['ESTUDIANTE'] },
    children: [
      { path: 'inicio', component: StudentRoutePage, canActivate: [authGuard, roleGuard], data: { roles: ['ESTUDIANTE'] } },
      { path: 'mi-practica', component: StudentRoutePage, canActivate: [authGuard, roleGuard], data: { roles: ['ESTUDIANTE'] } },
      { path: 'notificaciones', component: StudentRoutePage, canActivate: [authGuard, roleGuard], data: { roles: ['ESTUDIANTE'] } }
    ]
  },
  { path: 'home', component: ManagementHomePage },
  { path: 'login', component: LoginPage }
];

describe('Nested student route guards', () => {
  const authService = jasmine.createSpyObj<AuthService>('AuthService', ['obtenerContexto']);
  const contexto = (roles: string[]) => ({
    usuario: { id_usuario: 1, nombre: 'Prueba', apellido: 'Estudiante', correo: 'test@example.test' },
    roles, perfil: null, practica_actual: null
  });

  beforeEach(() => {
    // Aislamiento: otro spec del mismo navegador no debe dejar una sesión activa.
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), AuthStore, { provide: AuthService, useValue: authService }]
    });
  });

  afterEach(() => sessionStorage.clear());

  it('allows direct navigation to every child for an authenticated student', async () => {
    sessionStorage.setItem('access_token', 'synthetic');
    TestBed.inject(AuthStore).setContexto(contexto(['ESTUDIANTE']));
    const harness = await RouterTestingHarness.create('/estudiante/inicio');
    expect(harness.routeNativeElement?.textContent).toContain('student-child');
    await harness.navigateByUrl('/estudiante/mi-practica', StudentRoutesShell);
    expect(harness.routeNativeElement?.textContent).toContain('student-child');
    await harness.navigateByUrl('/estudiante/notificaciones', StudentRoutesShell);
    expect(harness.routeNativeElement?.textContent).toContain('student-child');
    TestBed.inject(AuthStore).setContexto(contexto(['ESTUDIANTE', 'GESTOR']));
    await harness.navigateByUrl('/estudiante/inicio', StudentRoutesShell);
    expect(harness.routeNativeElement?.textContent).toContain('student-child');
  });

  it('denies management-only users from nested student routes and sends them to /home', async () => {
    sessionStorage.setItem('access_token', 'synthetic');
    TestBed.inject(AuthStore).setContexto(contexto(['GESTOR']));
    const harness = await RouterTestingHarness.create('/estudiante/mi-practica');
    expect(harness.routeNativeElement?.textContent).toContain('management-home');
  });

  it('redirects an unauthenticated direct link to login', async () => {
    const harness = await RouterTestingHarness.create('/estudiante/notificaciones');
    expect(harness.routeNativeElement?.textContent).toContain('login-page');
  });
});
