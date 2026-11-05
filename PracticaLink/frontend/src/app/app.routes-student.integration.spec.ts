import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { ModalController } from '@ionic/angular';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from './app.routes';
import { AuthService } from './core/services/auth.service';
import { AuthStore } from './core/store/auth.store';
import { NotificacionService } from './features/notificaciones/services/notificacion.service';
import { StudentLayout } from './features/estudiante/layout/student-layout';

describe('Student home route integration', () => {
  let abrirModal: jasmine.Spy;

  beforeEach(() => {
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['obtenerContexto']);
    abrirModal = jasmine.createSpy('createModal').and.returnValue(Promise.resolve({
      present: jasmine.createSpy('present').and.returnValue(Promise.resolve())
    }));
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        provideRouter(routes),
        AuthStore,
        { provide: AuthService, useValue: auth },
        { provide: NotificacionService, useValue: { noLeidas: signal(0) } },
        { provide: ModalController, useValue: { create: abrirModal } }
      ]
    });
  });

  afterEach(() => sessionStorage.clear());

  it('sends a student-only direct /home link to the V3 student start route', async () => {
    sessionStorage.setItem('access_token', 'synthetic');
    TestBed.inject(AuthStore).setContexto({
      usuario: { id_usuario: 2, nombre: 'Estudiante', apellido: 'Prueba', correo: 'student@example.test' },
      roles: ['ESTUDIANTE'], perfil: null, practica_actual: null
    });

    const harness = await RouterTestingHarness.create('/home');
    expect(TestBed.inject(Router).url).toBe('/estudiante/inicio');
    expect(harness.fixture.nativeElement.querySelector('app-student-layout')).not.toBeNull();
    expect(harness.fixture.nativeElement.textContent).toContain('Hola, Estudiante Prueba');
  });

  it('opens the existing profile and practice forms from routed StudentHome actions', async () => {
    sessionStorage.setItem('access_token', 'synthetic');
    const authStore = TestBed.inject(AuthStore);
    authStore.setContexto({
      usuario: { id_usuario: 2, nombre: 'Estudiante', apellido: 'Prueba', correo: 'student@example.test' },
      roles: ['ESTUDIANTE'], perfil: null, practica_actual: null
    });
    const harness = await RouterTestingHarness.create('/estudiante/inicio');
    const layout = harness.fixture.debugElement.query(By.directive(StudentLayout)).componentInstance as StudentLayout;
    const abrirCompletarPerfil = spyOn(layout, 'abrirCompletarPerfil');
    const abrirRegistroPractica = spyOn(layout, 'abrirRegistroPractica');
    const completar = Array.from<HTMLButtonElement>(harness.fixture.nativeElement.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Completar perfil')) as HTMLButtonElement;
    completar.click();
    await harness.fixture.whenStable();
    expect(abrirCompletarPerfil).toHaveBeenCalled();

    authStore.setContexto({
      usuario: { id_usuario: 2, nombre: 'Estudiante', apellido: 'Prueba', correo: 'student@example.test' },
      roles: ['ESTUDIANTE'],
      perfil: { id_estudiante: 2, rut: '12345678-5', carrera: 'Ingeniería', sede: 'Central' },
      practica_actual: null
    });
    harness.fixture.detectChanges();
    const registrar = Array.from<HTMLButtonElement>(harness.fixture.nativeElement.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Registrar práctica')) as HTMLButtonElement;
    registrar.click();
    await harness.fixture.whenStable();
    expect(abrirRegistroPractica).toHaveBeenCalled();
  });

  it('renders one main landmark across student home and practice routes', async () => {
    sessionStorage.setItem('access_token', 'synthetic');
    TestBed.inject(AuthStore).setContexto({
      usuario: { id_usuario: 2, nombre: 'Estudiante', apellido: 'Prueba', correo: 'student@example.test' },
      roles: ['ESTUDIANTE'], perfil: null, practica_actual: null
    });

    const harness = await RouterTestingHarness.create('/estudiante/inicio');
    expect(harness.fixture.nativeElement.querySelectorAll('main').length).toBe(1);

    await harness.navigateByUrl('/estudiante/mi-practica');
    harness.fixture.detectChanges();
    expect(harness.fixture.nativeElement.querySelectorAll('main').length).toBe(1);
  });
});
