import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { SesionService } from '../../../core/session/sesion.service';
import { AuthStore } from '../../../core/store/auth.store';
import { NotificacionService } from '../../notificaciones/services/notificacion.service';
import { DocenteLayout } from './docente-layout';

describe('DocenteLayout', () => {
  let fixture: ComponentFixture<DocenteLayout>;
  let authStore: AuthStore;
  let noLeidas: ReturnType<typeof signal<number>>;

  const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 3, nombre: 'Dora', apellido: 'Docente', correo: 'docente@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  function crear(roles: string[]): void {
    authStore.setContexto(contextoCon(roles));
    fixture = TestBed.createComponent(DocenteLayout);
    fixture.detectChanges();
  }

  const texto = (): string => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    noLeidas = signal(0);
    await TestBed.configureTestingModule({
      imports: [DocenteLayout],
      providers: [
        provideRouter([]),
        AuthStore,
        { provide: NotificacionService, useValue: { noLeidas } },
        { provide: SesionService, useValue: jasmine.createSpyObj<SesionService>('SesionService', ['cerrar']) }
      ]
    }).compileComponents();
    authStore = TestBed.inject(AuthStore);
  });

  afterEach(() => fixture?.destroy());

  it('con un solo rol DOCENTE no muestra «Cambiar espacio»', () => {
    crear(['DOCENTE']);
    expect(texto()).not.toContain('Cambiar espacio');
  });

  it('con DOCENTE y otro rol muestra «Cambiar espacio»', () => {
    crear(['DOCENTE', 'GESTOR']);
    expect(texto()).toContain('Cambiar espacio');
  });

  it('muestra el contador de notificaciones no leídas', () => {
    noLeidas.set(4);
    crear(['DOCENTE']);
    const contadores = fixture.nativeElement.querySelectorAll('.student-layout__nav-count, .student-layout__topbar-count');
    expect(contadores.length).toBeGreaterThan(0);
    expect(texto()).toContain('4');
  });

  it('no ofrece «Mi perfil» en el menú de cuenta del docente', () => {
    crear(['DOCENTE']);
    (fixture.nativeElement.querySelector('.student-account__disparador') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.student-account__menu')).not.toBeNull();
    expect(texto()).not.toContain('Mi perfil');
    expect(texto()).toContain('Cerrar sesión');
  });

  it('expone la navegación del docente: prácticas y notificaciones', () => {
    crear(['DOCENTE']);
    const enlaces = Array.from(fixture.nativeElement.querySelectorAll('.student-layout__nav-item') as NodeListOf<HTMLAnchorElement>)
      .map(enlace => enlace.getAttribute('href'));
    expect(enlaces).toEqual(['/docente/practicas', '/docente/notificaciones']);
  });
});
