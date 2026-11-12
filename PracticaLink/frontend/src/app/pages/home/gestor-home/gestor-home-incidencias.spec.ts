import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Subject, of } from 'rxjs';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { IncidenciaPractica, PracticaEstadoResumen } from '../../../core/models/practica.models';
import { PracticaService } from '../../../core/services/practica.service';
import { RevisionService } from '../../../core/services/revision.service';
import { AuthStore } from '../../../core/store/auth.store';
import { NotificacionService } from '../../../features/notificaciones/services/notificacion.service';
import { Incidencias } from '../../incidencias/incidencias';
import { GestorHome } from './gestor-home';

/**
 * Etapa 0 · caracterización del conteo de incidencias.
 * Conviven dos vocabularios de estado: el legado (ABIERTA, EN_REVISION, RESUELTA, CERRADA,
 * practica.models.ts) y EP06 (PENDIENTE, EN_ATENCION, RESUELTA, incidencia.models.ts).
 * GestorHome y la página /incidencias aplican reglas distintas sobre el mismo GET /incidencias.
 * Sprint final: se corrige explícitamente el conteo de Inicio para incluir EP06.
 */
const hace = (dias: number): string => new Date(Date.now() - dias * 86_400_000).toISOString();

function incidencia(id: number, estado: string, prioridad: string): IncidenciaPractica {
  return {
    id_incidencia: id, id_practica: 100 + id, id_usuario: 1, usuario: 'Gestor sintético',
    fecha: hace(id), descripcion: `Incidencia ${estado}`, prioridad, estado,
    fecha_resolucion: null, alerta: false, estudiante: 'Estudiante sintético',
    centro_practica: 'Centro sintético', correo_estudiante: null
  } as unknown as IncidenciaPractica;
}

const MEZCLA: IncidenciaPractica[] = [
  incidencia(1, 'ABIERTA', 'MEDIA'),
  incidencia(2, 'EN_REVISION', 'ALTA'),
  incidencia(3, 'PENDIENTE', 'CRITICA'),
  incidencia(4, 'EN_ATENCION', 'ALTA'),
  incidencia(5, 'RESUELTA', 'CRITICA'),
  incidencia(6, 'CERRADA', 'ALTA')
];

const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
  usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Sintético', correo: 'gestor@example.test' },
  roles, perfil: null, practica_actual: null
});

describe('GestorHome · conteo de incidencias por estado (etapa 0)', () => {
  let fixture: ComponentFixture<GestorHome>;
  let practicaService: jasmine.SpyObj<PracticaService>;
  let revisionService: jasmine.SpyObj<RevisionService>;
  let authStore: AuthStore;

  const indicadorIncidencias = (): HTMLElement =>
    fixture.nativeElement.querySelectorAll('.gh-indicador')[2] as HTMLElement;
  const texto = (): string => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');

  function crear(roles: string[], incidencias: IncidenciaPractica[]): void {
    practicaService.listarIncidencias.and.returnValue(of(incidencias));
    authStore.setContexto(contextoCon(roles));
    fixture = TestBed.createComponent(GestorHome);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', ['listar']);
    revisionService.listar.and.returnValue(of([]));
    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'listarIncidencias', 'listarEstudiantesSinPractica', 'enviarRecordatorioEstudiante'
    ]);
    practicaService.listarEstudiantesSinPractica.and.returnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [GestorHome],
      providers: [
        AuthStore,
        { provide: RevisionService, useValue: revisionService },
        { provide: PracticaService, useValue: practicaService },
        { provide: NotificacionService, useValue: { noLeidas: signal(0) } },
        { provide: Router, useValue: Object.assign(jasmine.createSpyObj<Router>('Router', ['navigate']),
          { events: new Subject<Event>(), url: '/home' }) },
        { provide: NavController, useValue: jasmine.createSpyObj<NavController>('NavController', ['navigateRoot']) }
      ]
    }).compileComponents();
    authStore = TestBed.inject(AuthStore);
  });

  afterEach(() => fixture?.destroy());

  it('cuenta ABIERTA, EN_REVISION, PENDIENTE y EN_ATENCION', () => {
    crear(['GESTOR'], MEZCLA);
    expect(indicadorIncidencias().querySelector('strong')?.textContent?.trim()).toBe('4');
    expect(indicadorIncidencias().textContent).toContain('3 de prioridad alta');
    expect(texto()).toContain('4 incidencias abiertas');
  });

  it('la lista de recientes incluye incidencias EP06 sin resolver', () => {
    crear(['GESTOR'], MEZCLA);
    const descripciones = Array.from(fixture.nativeElement.querySelectorAll('.gh-incidencia__descripcion') as NodeListOf<HTMLElement>)
      .map(item => item.textContent?.trim());
    expect(descripciones).toEqual(['Incidencia ABIERTA', 'Incidencia EN_REVISION', 'Incidencia PENDIENTE', 'Incidencia EN_ATENCION']);
  });

  it('con solo incidencias EP06 pendientes muestra su conteo real', () => {
    crear(['GESTOR'], [incidencia(3, 'PENDIENTE', 'CRITICA'), incidencia(4, 'EN_ATENCION', 'ALTA')]);
    expect(indicadorIncidencias().querySelector('strong')?.textContent?.trim()).toBe('2');
    expect(texto()).not.toContain('No hay incidencias abiertas.');
  });

  it('las incidencias recientes no son navegables hacia la práctica', () => {
    crear(['GESTOR'], MEZCLA);
    const item = fixture.nativeElement.querySelector('.gh-incidencia') as HTMLElement;
    expect(item.querySelector('button, a')).toBeNull();
  });

  it('una cuenta GESTOR + ADMINISTRADOR obtiene los mismos datos y conteos', () => {
    crear(['GESTOR', 'ADMINISTRADOR'], MEZCLA);
    expect(practicaService.listarIncidencias).toHaveBeenCalledTimes(1);
    expect(revisionService.listar).toHaveBeenCalledTimes(1);
    expect(indicadorIncidencias().querySelector('strong')?.textContent?.trim()).toBe('4');
  });
});

describe('Incidencias (/incidencias) · conteo de pendientes con el mismo origen (etapa 0)', () => {
  let fixture: ComponentFixture<Incidencias>;
  let component: Incidencias;
  let practicaService: jasmine.SpyObj<PracticaService>;

  const practica = { id_practica: 101, estado: 'EN_CURSO', es_final: false } as PracticaEstadoResumen;

  beforeEach(async () => {
    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'listarPracticasParaGestion', 'listarIncidencias', 'registrarIncidencia'
    ]);
    practicaService.listarPracticasParaGestion.and.returnValue(of([practica]));
    practicaService.listarIncidencias.and.returnValue(of(MEZCLA));
    await TestBed.configureTestingModule({
      imports: [Incidencias],
      providers: [
        AuthStore,
        { provide: PracticaService, useValue: practicaService },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) }
      ]
    }).compileComponents();
    TestBed.inject(AuthStore).setContexto(contextoCon(['GESTOR']));
    fixture = TestBed.createComponent(Incidencias);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('considera pendiente todo estado distinto de RESUELTA y CERRADA (4 de 6)', () => {
    expect(component.pendientes()).toBe(4);
    // El tipo legado no incluye PENDIENTE/EN_ATENCION: se compara como texto recibido del servidor.
    expect(component.incidenciasVisibles().map(item => String(item.estado)))
      .toEqual(['ABIERTA', 'EN_REVISION', 'PENDIENTE', 'EN_ATENCION']);
  });

  it('las tarjetas enlazan la ficha cuando la práctica está en el listado autorizado', () => {
    expect((fixture.nativeElement.textContent as string)).toContain('El cambio de estado se gestiona desde la ficha de la práctica.');
    expect(fixture.nativeElement.querySelector('.incident-card ion-button')?.textContent)
      .toContain('Historial y gestión de la incidencia');
  });
});
