import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { HistorialPracticaResponse, PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { PracticaDetalle } from './practica-detalle';

describe('Historial en el detalle de práctica', () => {
  let fixture: ComponentFixture<PracticaDetalle>;
  let component: PracticaDetalle;
  let service: jasmine.SpyObj<PracticaService>;
  let parametros: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const detalle: PracticaDetalleGestionResponse = {
    id_practica: 15, estudiante: { id_estudiante: 7, nombre: 'Estudiante sintético' },
    centro_practica: { id_centro: 9, nombre: 'Centro sintético' },
    fecha_registro: '2026-10-17T12:30:00Z', estado: { id_estado: 3, nombre: 'OBSERVADA', es_final: false },
    fecha_ultimo_cambio_estado: null, fecha_inicio: null, fecha_termino: null,
    horas: null, cargo_funcion: null, descripcion: null
  };
  const historial: HistorialPracticaResponse = {
    id_practica: 15, limit: 50, offset: 0, hay_mas: true,
    items: [
      { id_historial: 10, estado_anterior: null, estado_nuevo: { id_estado: 3, nombre: 'OBSERVADA' },
        fecha_cambio: '2026-07-17T12:30:00Z', responsable: { id_usuario: 42, nombre: 'Responsable sintético' }, observacion: null },
      { id_historial: 11, estado_anterior: { id_estado: 3, nombre: 'OBSERVADA' }, estado_nuevo: { id_estado: 3, nombre: 'OBSERVADA' },
        fecha_cambio: '2026-10-17T12:30:00Z', responsable: { id_usuario: 42, nombre: 'Responsable sintético' }, observacion: '<img src=x onerror=alert(1)> Observación sintética' }
    ]
  };
  beforeEach(async () => {
    service = jasmine.createSpyObj<PracticaService>('PracticaService', ['obtenerDetalle', 'obtenerHistorial']);
    service.obtenerDetalle.and.returnValue(of(detalle));
    service.obtenerHistorial.and.returnValue(of(historial));
    parametros = new BehaviorSubject(convertToParamMap({ id: '15' }));
    await TestBed.configureTestingModule({ imports: [PracticaDetalle], providers: [
      { provide: PracticaService, useValue: service },
      { provide: ActivatedRoute, useValue: { paramMap: parametros } },
      { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) }
    ] }).compileComponents();
    fixture = TestBed.createComponent(PracticaDetalle); component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  function section(): HTMLElement { return fixture.nativeElement.querySelector('.history-section'); }

  it('renders chronological and repeated events without assuming registration', () => {
    expect(service.obtenerHistorial).toHaveBeenCalledWith('15', 50, 0);
    const events = section().querySelectorAll('li');
    expect(events.length).toBe(2);
    expect(events[0].textContent).toContain('Sin estado anterior registrado');
    expect(events[0].textContent).toContain('17/07/2026, 08:30');
    expect(events[1].textContent?.replace(/\s+/g, ' ')).toContain('OBSERVADA → OBSERVADA');
    expect(events[1].textContent).toContain('17/10/2026, 09:30');
    expect(events[0].textContent).not.toContain('Registro inicial');
    expect(section().textContent).toContain('Responsable sintético');
    expect(section().querySelectorAll('.history-observation').length).toBe(1);
  });

  it('renders observations as text and offers no review actions or personal identifiers', () => {
    expect(section().textContent).toContain('<img src=x onerror=alert(1)>');
    expect(section().querySelector('img')).toBeNull();
    for (const text of ['RUT', 'Correo', 'Teléfono', 'Aprobar', 'Rechazar', 'Observar']) expect(section().textContent).not.toContain(text);
  });

  it('paginates without reloading the antecedents and obeys hay_mas', () => {
    service.obtenerDetalle.calls.reset();
    component.siguienteHistorial();
    expect(service.obtenerHistorial).toHaveBeenCalledWith('15', 50, 50);
    component.anteriorHistorial();
    expect(service.obtenerHistorial).toHaveBeenCalledWith('15', 50, 0);
    component.hayMasHistorial = false; service.obtenerHistorial.calls.reset();
    component.siguienteHistorial(); component.anteriorHistorial();
    expect(service.obtenerHistorial).not.toHaveBeenCalled();
    expect(service.obtenerDetalle).not.toHaveBeenCalled();
  });

  it('shows empty history while preserving antecedents', () => {
    service.obtenerHistorial.and.returnValue(of({ ...historial, items: [], hay_mas: false }));
    component.cargarHistorial(); fixture.detectChanges();
    expect(section().textContent).toContain('No hay eventos de historial registrados');
    expect(component.detalle).toEqual(detalle);
  });

  it('has independent loading and error and retries the failed page', () => {
    const pending = new Subject<HistorialPracticaResponse>();
    service.obtenerHistorial.and.returnValue(pending);
    component.siguienteHistorial(); fixture.detectChanges();
    expect(section().querySelector('ion-spinner')).not.toBeNull();
    expect(component.cargando).toBeFalse(); expect(component.detalle).toEqual(detalle);
    pending.error(new HttpErrorResponse({ status: 500 })); fixture.detectChanges();
    expect(section().querySelector('[role="alert"]')).not.toBeNull();
    service.obtenerHistorial.and.returnValue(of(historial)); service.obtenerDetalle.calls.reset();
    const retry = Array.from(section().querySelectorAll('ion-button')).find(button => button.textContent?.includes('Reintentar')) as HTMLElement;
    retry.click();
    expect(service.obtenerHistorial).toHaveBeenCalledWith('15', 50, 50);
    expect(component.errorHistorial).toBe('');
    expect(service.obtenerDetalle).not.toHaveBeenCalled();
  });

  it('cancels obsolete requests across pages, practice changes and destruction', () => {
    const old = new Subject<HistorialPracticaResponse>();
    const latest = new Subject<HistorialPracticaResponse>();
    const other = new Subject<HistorialPracticaResponse>();
    service.obtenerHistorial.and.returnValues(old, latest, other);
    component.cargarHistorial(50); component.cargarHistorial(100);
    expect(old.observed).toBeFalse();
    old.next(historial); expect(component.eventos).toEqual([]);
    parametros.next(convertToParamMap({ id: '16' }));
    expect(latest.observed).toBeFalse();
    expect(service.obtenerHistorial).toHaveBeenCalledWith('16', 50, 0);
    expect(component.offsetHistorial).toBe(0);
    other.next({ ...historial, id_practica: 16 });
    expect(component.eventos).toEqual(historial.items);
    component.ngOnDestroy(); expect(other.observed).toBeFalse();
  });

  it('preserves history when retrying antecedents and isolates history HTTP errors', () => {
    for (const status of [401, 403, 404]) {
      service.obtenerHistorial.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      component.cargarHistorial(); fixture.detectChanges();
      expect(component.errorHistorial).toContain(status === 404 ? 'La práctica no existe' : 'Acceso denegado');
      expect(component.detalle).toEqual(detalle);
    }
    service.obtenerHistorial.calls.reset(); component.cargar();
    expect(service.obtenerHistorial).not.toHaveBeenCalled();
  });

  it('does not request history for an invalid practice id', () => {
    service.obtenerHistorial.calls.reset();
    parametros.next(convertToParamMap({ id: 'invalid' })); fixture.detectChanges();
    expect(service.obtenerHistorial).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.history-section')).toBeNull();
  });
});
