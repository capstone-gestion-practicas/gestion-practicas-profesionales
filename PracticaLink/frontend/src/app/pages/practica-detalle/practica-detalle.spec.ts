import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { PracticaDetalle } from './practica-detalle';

describe('PracticaDetalle', () => {
  let fixture: ComponentFixture<PracticaDetalle>;
  let component: PracticaDetalle;
  let service: jasmine.SpyObj<PracticaService>;
  let parametros: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const detalle: PracticaDetalleGestionResponse = {
    id_practica: 15, estudiante: { id_estudiante: 7, nombre: 'Estudiante sintético' },
    centro_practica: { id_centro: 9, nombre: 'Centro sintético' },
    fecha_registro: '2026-10-17T12:30:00Z', estado: { id_estado: 6, nombre: 'FINALIZADA', es_final: true },
    fecha_ultimo_cambio_estado: '2026-07-17T12:30:00Z', fecha_inicio: '2026-03-02',
    fecha_termino: '2026-06-30', horas: 360, cargo_funcion: 'Desarrollo', descripcion: 'Antecedentes sintéticos'
  };
  beforeEach(async () => {
    service = jasmine.createSpyObj<PracticaService>('PracticaService', ['obtenerDetalle', 'obtenerSeguimientos', 'obtenerHistorial']);
    service.obtenerSeguimientos.and.returnValue(of({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false }));
    service.obtenerDetalle.and.returnValue(of(detalle));
    service.obtenerHistorial.and.returnValue(of({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false }));
    parametros = new BehaviorSubject(convertToParamMap({ id: '15' }));
    await TestBed.configureTestingModule({ imports: [PracticaDetalle], providers: [
      { provide: PracticaService, useValue: service },
      { provide: ActivatedRoute, useValue: { paramMap: parametros } },
      { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) }
    ] }).compileComponents();
    fixture = TestBed.createComponent(PracticaDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it('loads the selected practice and renders approved antecedents', () => {
    expect(service.obtenerDetalle).toHaveBeenCalledWith('15');
    const text = fixture.nativeElement.textContent;
    for (const value of ['Práctica 15', 'Estudiante sintético', 'Centro sintético', 'FINALIZADA', '360', 'Desarrollo', 'Antecedentes sintéticos']) expect(text).toContain(value);
    expect(text).toContain('17/10/2026, 09:30');
    expect(text).toContain('17/07/2026, 08:30');
    expect(text).toContain('02/03/2026');
    expect(text).toContain('30/06/2026');
  });

  it('renders nullable fields and does not shift calendar dates', () => {
    service.obtenerDetalle.and.returnValue(of({ ...detalle, fecha_ultimo_cambio_estado: null,
      fecha_inicio: null, fecha_termino: null, horas: null, cargo_funcion: null, descripcion: null
    }));
    component.cargar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Fecha no disponible');
    expect(fixture.nativeElement.textContent).toContain('No disponible');
    expect(component.formatearFecha('2026-01-01')).toBe('01/01/2026');
    expect(component.formatearFecha('2026-07-01')).toBe('01/07/2026');
  });

  it('shows final and non-final states without review actions or personal fields', () => {
    for (const [nombre, es_final] of [['RECHAZADA', true], ['EN_CURSO', false]] as const) {
      service.obtenerDetalle.and.returnValue(of({ ...detalle, estado: { id_estado: 1, nombre, es_final } }));
      component.cargar(); fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(nombre);
      const entries = Array.from(fixture.nativeElement.querySelectorAll('.summary-item')) as HTMLElement[];
      expect(entries.find(item => item.querySelector('.label')?.textContent === 'Estado final')
        ?.querySelector('strong')?.textContent).toBe(es_final ? 'Sí' : 'No');
    }
    for (const forbidden of ['RUT', 'Correo', 'Teléfono', 'Aprobar', 'Observar', 'Rechazar', 'Cambiar estado']) expect(fixture.nativeElement.textContent).not.toContain(forbidden);
  });

  it('shows not found and denied states without stale details', () => {
    for (const status of [404, 401, 403]) {
      service.obtenerDetalle.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      component.cargar(); fixture.detectChanges();
      expect(component.detalle).toBeNull();
      expect(component.permiteReintentar).toBeFalse();
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(status === 404 ? 'La práctica no existe' : 'Acceso denegado');
    }
  });

  it('retries a general error with the same identifier', () => {
    service.obtenerDetalle.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    component.cargar(); fixture.detectChanges();
    expect(component.permiteReintentar).toBeTrue();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('ion-button')) as HTMLElement[];
    service.obtenerDetalle.and.returnValue(of(detalle));
    buttons.find(item => item.textContent?.trim() === 'Reintentar')!.click();
    expect(service.obtenerDetalle).toHaveBeenCalledWith('15');
    expect(component.detalle).toEqual(detalle);
    expect(component.error).toBe('');
  });

  it('shows loading and cancels obsolete requests when route changes', () => {
    const old = new Subject<PracticaDetalleGestionResponse>();
    const latest = new Subject<PracticaDetalleGestionResponse>();
    service.obtenerDetalle.and.returnValues(old, latest);
    component.cargar(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-spinner')).not.toBeNull();
    parametros.next(convertToParamMap({ id: '16' }));
    expect(old.observed).toBeFalse();
    old.next(detalle); expect(component.detalle).toBeNull();
    latest.next({ ...detalle, id_practica: 16 });
    expect(component.detalle?.id_practica).toBe(16);
    component.ngOnDestroy(); expect(latest.observed).toBeFalse();
  });

  it('rejects invalid identifiers without API calls and preserves bigint path precision', () => {
    service.obtenerDetalle.calls.reset();
    for (const id of ['abc', '0', '-1', '9223372036854775808']) {
      parametros.next(convertToParamMap({ id })); expect(component.error).toContain('identificador');
    }
    expect(service.obtenerDetalle).not.toHaveBeenCalled();
    parametros.next(convertToParamMap({ id: '9223372036854775807' }));
    expect(service.obtenerDetalle).toHaveBeenCalledWith('9223372036854775807');
  });

  it('opens the follow-up registration from the detail page', () => {
    const button = Array.from(fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(item => item.textContent?.trim() === 'Registrar seguimiento');
    button!.click();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith([
      '/practicas', '15', 'seguimiento', 'nuevo'
    ]);
  });
});
