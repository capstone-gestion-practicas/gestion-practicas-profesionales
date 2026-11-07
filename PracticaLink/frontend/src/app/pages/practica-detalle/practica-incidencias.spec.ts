import { DocenteService } from '../../features/docente/docente.service';
import { NavController } from '@ionic/angular';
import { By } from '@angular/platform-browser';
import { HttpResponse } from '@angular/common/http';
import { IncidenciaEstado } from './incidencia-estado';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { IncidenciasHistorialResponse } from '../../core/models/incidencia.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { PracticaDetalle } from './practica-detalle';

describe('HU015 consulta persistente', () => {
  let fixture: ComponentFixture<PracticaDetalle>;
  let component: PracticaDetalle;
  let service: jasmine.SpyObj<PracticaService>;
  let parametros: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const historial: IncidenciasHistorialResponse = {
    id_practica: 15, limit: 50, offset: 0, hay_mas: true,
    items: [
      { id_incidencia: 9, id_practica: 15, id_usuario: 101, tipo: 'SALUD',
        descripcion: 'Incidencia persistida', estado: 'PENDIENTE', fecha: '2026-07-02T03:30:00Z',
        sin_tipo_registrado: false, fecha_resolucion: null, resolucion: null },
      { id_incidencia: 3, id_practica: 15, id_usuario: 102, tipo: null,
        descripcion: '<b>Histórico</b>' + 'x'.repeat(2001), estado: 'CERRADA', fecha: '2026-01-01T12:00:00Z',
        sin_tipo_registrado: true, fecha_resolucion: '2026-01-02T12:00:00Z', resolucion: null }
    ]
  };
  beforeEach(async () => {
    service = jasmine.createSpyObj('PracticaService', ['obtenerDetalle', 'obtenerHistorial', 'obtenerSeguimientos', 'obtenerIncidencias', 'obtenerHistorialIncidencia', 'cambiarEstadoIncidencia']);
    service.obtenerDetalle.and.returnValue(of({
      id_practica: 15, estudiante: { id_estudiante: 7, nombre: 'Sintético' },
      centro_practica: { id_centro: 1, nombre: 'Centro' },
      estado: { id_estado: 6, nombre: 'FINALIZADA', es_final: true },
      fecha_registro: '2026-01-01T12:00:00Z', fecha_ultimo_cambio_estado: null,
      fecha_inicio: null, fecha_termino: null, horas: null, cargo_funcion: null, descripcion: null
    }));
    const empty = { id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false };
    service.obtenerHistorial.and.returnValue(of(empty));
    service.obtenerSeguimientos.and.returnValue(of(empty));
    service.obtenerIncidencias.and.returnValue(of(historial));
    parametros = new BehaviorSubject(convertToParamMap({ id: '15' }));
    const docentes = jasmine.createSpyObj<DocenteService>('DocenteService', ['consultarAsignacion']);
    docentes.consultarAsignacion.and.returnValue(of({
      id_practica: 15, docente_actual: null, docentes_disponibles: []
    }));
    await TestBed.configureTestingModule({ imports: [PracticaDetalle], providers: [
      { provide: DocenteService, useValue: docentes },
      { provide: PracticaService, useValue: service },
      { provide: ActivatedRoute, useValue: { paramMap: parametros } },
      { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      { provide: NavController, useValue: jasmine.createSpyObj('NavController', ['navigateRoot']) }
    ] }).compileComponents();
    TestBed.inject(AuthStore).setContexto({
      usuario: { id_usuario: 101, nombre: 'Gestor', apellido: 'Sintético', correo: 'test@example.invalid' },
      roles: ['GESTOR'], perfil: null, practica_actual: null
    });
    fixture = TestBed.createComponent(PracticaDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  function abrir(): void {
    component.seleccionarVista('incidencias'); fixture.detectChanges();
  }

  it('HU016 refreshes the actual GET after 200 even on a finalized practice', () => {
    const original = historial.items[0];
    service.obtenerHistorialIncidencia.and.returnValue(of({
      id_practica: 15, id_incidencia: 9, limit: 50, offset: 0, hay_mas: false,
      items: [{ id_historial: 1, id_usuario: 101, estado_anterior: null,
        estado_nuevo: 'PENDIENTE', fecha: original.fecha, comentario: null }]
    }));
    service.cambiarEstadoIncidencia.and.returnValue(of(new HttpResponse({ status: 200, body: {
      id_practica: 15, id_incidencia: 9, id_historial: 2, id_usuario: 101,
      estado_anterior: 'PENDIENTE' as const, estado_nuevo: 'RESUELTA' as const, comentario: 'Resuelto',
      fecha: '2026-07-03T12:00:00Z'
    } })));
    abrir();
    component.seleccionarIncidencia(original); fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(IncidenciaEstado)).componentInstance as IncidenciaEstado;
    expect(panel.transiciones).toContain('RESUELTA');
    service.obtenerIncidencias.and.returnValue(of({ ...historial, items: [{
      ...original, estado: 'RESUELTA', fecha_resolucion: '2026-07-03T12:00:00Z',
      resolucion: { id_historial: 2, id_usuario: 101, fecha: '2026-07-03T12:00:00Z', comentario: 'Resuelto' }
    }] }));
    panel.destino = 'RESUELTA'; panel.comentario = 'Resuelto'; panel.guardar(); fixture.detectChanges();
    expect(service.obtenerIncidencias).toHaveBeenCalledTimes(2);
    expect(component.incidenciaSeleccionada).toBeNull();
    expect(component.registrosIncidencia[0].estado).toBe('RESUELTA');
    expect(fixture.nativeElement.textContent).toContain('Responsable de resolución: Usuario #101');
    expect(original.estado).toBe('PENDIENTE');
  });

  it('renders server order, historical data and Santiago time for finalized practices', () => {
    abrir();
    expect(service.obtenerIncidencias).toHaveBeenCalledOnceWith('15', 50, 0);
    expect(component.registrosIncidencia.map(item => item.id_incidencia)).toEqual([9, 3]);
    const text = fixture.nativeElement.textContent;
    for (const value of ['SALUD', 'PENDIENTE', 'Usuario #101', '01/07/2026, 23:30',
      'Sin tipo registrado', 'CERRADA', historial.items[1].descripcion, 'Fecha de resolución:']) {
      expect(text).toContain(value);
    }
    expect(text).not.toContain('Responsable de resolución:');
    expect(fixture.nativeElement.querySelector('.history-observation b')).toBeNull();
    expect(component.registrosIncidencia[0].fecha).toBe(historial.items[0].fecha);
  });

  it('shows only resolution fields provided and preserves infinite timestamps', () => {
    service.obtenerIncidencias.and.returnValue(of({ ...historial, items: [{
      ...historial.items[1], fecha: '-infinity', fecha_resolucion: null,
      resolucion: { id_historial: 4, id_usuario: 103, fecha: 'infinity', comentario: 'Resuelto' }
    }] }));
    abrir();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('-infinity');
    expect(text).toContain('Responsable de resolución: Usuario #103');
    expect(text).toContain('Fecha del evento de resolución: infinity');
    expect(text).toContain('Comentario: Resuelto');
    expect(text).not.toContain('Fecha de resolución:');
  });

  it('waits for success before showing empty and prevents duplicate requests', () => {
    const pending = new Subject<IncidenciasHistorialResponse>();
    service.obtenerIncidencias.and.returnValue(pending);
    abrir(); abrir(); component.cargarIncidencias();
    expect(service.obtenerIncidencias).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Cargando incidencias');
    expect(fixture.nativeElement.textContent).not.toContain('No hay incidencias registradas');
    pending.next({ ...historial, items: [], hay_mas: false }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay incidencias registradas para esta práctica');
    component.siguienteIncidencias();
    expect(service.obtenerIncidencias).toHaveBeenCalledTimes(1);
  });

  it('paginates by 50, respects hay_mas and retries manually without tab retries', () => {
    abrir();
    service.obtenerIncidencias.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    component.siguienteIncidencias();
    expect(service.obtenerIncidencias).toHaveBeenCalledWith('15', 50, 50);
    component.seleccionarVista('seguimientos'); abrir();
    expect(service.obtenerIncidencias).toHaveBeenCalledTimes(2);
    service.obtenerIncidencias.and.returnValue(of({ ...historial, items: [], offset: 50, hay_mas: false }));
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('ion-button')) as HTMLElement[];
    buttons.find(button => button.textContent?.includes('Reintentar incidencias'))!.click();
    fixture.detectChanges();
    expect(service.obtenerIncidencias).toHaveBeenCalledTimes(3);
    expect(fixture.nativeElement.textContent).toContain('No hay incidencias en esta página');
    component.siguienteIncidencias();
    expect(service.obtenerIncidencias).toHaveBeenCalledTimes(3);
    component.anteriorIncidencias();
    expect(service.obtenerIncidencias).toHaveBeenCalledWith('15', 50, 0);
  });

  it('cancels A, clears its data and ignores stale responses when B is selected', () => {
    abrir();
    const pending = new Subject<IncidenciasHistorialResponse>();
    service.obtenerIncidencias.and.returnValue(pending);
    component.cargarIncidencias();
    parametros.next(convertToParamMap({ id: '16' }));
    expect(pending.observed).toBeFalse();
    expect(component.registrosIncidencia).toEqual([]);
    expect(component.errorIncidencias).toBe('');
    expect(component.offsetIncidencias).toBe(0);
    pending.next(historial);
    expect(component.registrosIncidencia).toEqual([]);
    service.obtenerIncidencias.and.returnValue(of({ ...historial, id_practica: 16, items: [] }));
    abrir();
    expect(service.obtenerIncidencias).toHaveBeenCalledWith('16', 50, 0);
  });

  it('does not access or mutate demonstration storage', () => {
    const read = spyOn(localStorage, 'getItem');
    const write = spyOn(localStorage, 'setItem');
    const remove = spyOn(localStorage, 'removeItem');
    const clear = spyOn(localStorage, 'clear');
    abrir(); component.siguienteIncidencias();
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
  });

  for (const role of ['ESTUDIANTE', 'ADMINISTRADOR']) {
    it('enforces the existing context for ' + role, () => {
      const auth = TestBed.inject(AuthStore);
      auth.setContexto({ ...auth.contexto()!, roles: [role] });
      abrir();
      expect(service.obtenerIncidencias.calls.count()).toBe(role === 'ADMINISTRADOR' ? 1 : 0);
    });
  }

  for (const status of [401, 403, 404, 422, 500, 503, 0]) {
    it('handles HTTP ' + status + ' without false empty or internal details', () => {
      service.obtenerIncidencias.and.returnValue(throwError(() => new HttpErrorResponse({
        status, error: { detail: 'internal-secret' }
      })));
      abrir();
      expect(component.errorIncidencias).not.toBe('');
      expect(component.incidenciasConsultadas).toBeFalse();
      expect(fixture.nativeElement.textContent).not.toContain('No hay incidencias registradas');
      expect(fixture.nativeElement.textContent).not.toContain('internal-secret');
      expect(service.obtenerIncidencias).toHaveBeenCalledTimes(1);
      if (status === 401) {
        expect(TestBed.inject(AuthStore).contexto()).toBeNull();
        expect(TestBed.inject(NavController).navigateRoot).toHaveBeenCalledWith(['/login']);
      }
    });
  }
});
