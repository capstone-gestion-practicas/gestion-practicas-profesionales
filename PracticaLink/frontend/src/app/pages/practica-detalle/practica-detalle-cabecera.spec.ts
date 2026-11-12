import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { CLAVE_ESPACIO_TRABAJO } from '../../core/navigation/espacio-gestor';
import { PracticaService } from '../../core/services/practica.service';
import { SesionService } from '../../core/session/sesion.service';
import { AuthStore } from '../../core/store/auth.store';
import { DocenteService } from '../../features/docente/docente.service';
import { PracticaDetalle } from './practica-detalle';

/**
 * Etapa 3a: la barra propia del detalle (miga «PracticaLink · Detalle de práctica» y avatar)
 * se oculta en el espacio GESTOR, donde GestorLayout ya muestra su cabecera, y se conserva
 * para el ADMINISTRADOR. El regreso al listado queda disponible para todos.
 */
describe('PracticaDetalle · cabecera y regreso al listado (etapa 3a)', () => {
  let fixture: ComponentFixture<PracticaDetalle>;
  let router: jasmine.SpyObj<Router>;
  let service: jasmine.SpyObj<PracticaService>;
  let roles: string[];

  const detalle: PracticaDetalleGestionResponse = {
    id_practica: 15, estudiante: { id_estudiante: 7, nombre: 'Estudiante sintético' },
    centro_practica: { id_centro: 9, nombre: 'Centro sintético' },
    fecha_registro: '2026-10-17T12:30:00Z',
    estado: { id_estado: 5, nombre: 'EN_CURSO', es_final: false },
    fecha_ultimo_cambio_estado: null, fecha_inicio: null, fecha_termino: null,
    horas: null, cargo_funcion: null, descripcion: null
  };

  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const botonVolver = (): HTMLElement | undefined =>
    Array.from(raiz().querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(boton => boton.textContent?.trim() === '← Volver a prácticas');

  async function crear(rolesUsuario: string[], espacio: string | null = null): Promise<void> {
    roles = rolesUsuario;
    if (espacio) sessionStorage.setItem(CLAVE_ESPACIO_TRABAJO, espacio);
    await TestBed.configureTestingModule({ imports: [PracticaDetalle], providers: [
      { provide: PracticaService, useValue: service },
      { provide: DocenteService, useValue: jasmine.createSpyObj<DocenteService>('DocenteService', {
        consultarAsignacion: of({ id_practica: 15, docente_actual: null, docentes_disponibles: [] })
      }) },
      { provide: SesionService, useValue: jasmine.createSpyObj<SesionService>('SesionService', ['cerrar']) },
      { provide: AuthStore, useValue: {
        contexto: () => ({ roles, usuario: { id_usuario: 1, nombre: 'Cuenta', apellido: 'Sintética' } })
      } },
      { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: '15' })) } },
      { provide: Router, useValue: router }
    ] }).compileComponents();
    fixture = TestBed.createComponent(PracticaDetalle);
    fixture.detectChanges();
  }

  beforeEach(() => {
    sessionStorage.removeItem(CLAVE_ESPACIO_TRABAJO);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    service = jasmine.createSpyObj<PracticaService>('PracticaService', ['obtenerDetalle', 'obtenerSeguimientos', 'obtenerHistorial']);
    service.obtenerDetalle.and.returnValue(of(detalle));
    service.obtenerSeguimientos.and.returnValue(of({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false }));
    service.obtenerHistorial.and.returnValue(of({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false }));
  });

  afterEach(() => {
    fixture?.destroy();
    sessionStorage.removeItem(CLAVE_ESPACIO_TRABAJO);
  });

  const casos: [string, string[], string | null, boolean][] = [
    ['GESTOR dedicado', ['GESTOR'], null, false],
    ['ESTUDIANTE + GESTOR', ['ESTUDIANTE', 'GESTOR'], null, false],
    ['GESTOR + ADMINISTRADOR en espacio GESTOR', ['GESTOR', 'ADMINISTRADOR'], 'GESTOR', false],
    ['ADMINISTRADOR', ['ADMINISTRADOR'], null, true],
    ['ADMINISTRADOR con espacio GESTOR guardado', ['ADMINISTRADOR'], 'GESTOR', true],
    ['GESTOR + ADMINISTRADOR sin espacio elegido', ['GESTOR', 'ADMINISTRADOR'], null, true],
    ['GESTOR + ADMINISTRADOR en espacio ADMINISTRADOR', ['GESTOR', 'ADMINISTRADOR'], 'ADMINISTRADOR', true]
  ];

  for (const [caso, rolesCaso, espacio, conBarraPropia] of casos) {
    it(`${caso}: ${conBarraPropia ? 'conserva' : 'oculta'} la barra propia y ofrece volver al listado`, async () => {
      await crear(rolesCaso, espacio);
      expect(raiz().querySelector('.topbar') !== null).toBe(conBarraPropia);
      expect(raiz().querySelector('.breadcrumb') !== null).toBe(conBarraPropia);
      expect(raiz().querySelector('.avatar-mini') !== null).toBe(conBarraPropia);
      expect(botonVolver()).toBeDefined();
    });
  }

  it('la barra conservada del ADMINISTRADOR sigue llevando a /home', async () => {
    await crear(['ADMINISTRADOR']);
    (raiz().querySelector('.breadcrumb button') as HTMLButtonElement).click();
    expect(router.navigate).toHaveBeenCalledWith(['/home']);
  });

  it('«Volver a prácticas» navega al listado /practicas', async () => {
    await crear(['GESTOR']);
    botonVolver()?.click();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/practicas']);
  });

  it('el regreso sigue disponible cuando el detalle responde 403', async () => {
    service.obtenerDetalle.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    await crear(['GESTOR']);
    expect(raiz().textContent).toContain('Acceso denegado');
    expect(botonVolver()).toBeDefined();
  });

  it('usa la etiqueta «Detalle de práctica» sin códigos internos', async () => {
    await crear(['GESTOR']);
    expect(raiz().querySelector('.eyebrow')?.textContent?.trim()).toBe('Detalle de práctica');
    expect(raiz().textContent).not.toContain('EP04');
    expect(raiz().textContent).not.toContain('SEGUIMIENTO');
  });
});
