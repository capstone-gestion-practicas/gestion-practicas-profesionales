import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { PracticasListadoResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { PracticasListado } from './practicas-listado';

describe('PracticasListado', () => {
  let fixture: ComponentFixture<PracticasListado>;
  let component: PracticasListado;
  let service: jasmine.SpyObj<PracticaService>;
  const respuesta: PracticasListadoResponse = {
    items: ['REGISTRADA', 'EN_REVISION', 'OBSERVADA', 'APROBADA', 'EN_CURSO', 'FINALIZADA', 'RECHAZADA'].map((nombre, index) => ({
      id_practica: index + 1, estudiante: { id_estudiante: 1, nombre: 'Estudiante sintético' },
      centro_practica: 'Centro sintético', fecha_registro: '2026-10-17T12:30:00Z',
      estado: { id_estado: index + 1, nombre, es_final: index > 4 },
      fecha_ultimo_cambio_estado: index === 0 ? '2026-07-17T12:30:00Z' : null
    })), limit: 50, offset: 0, hay_mas: true
  };

  beforeEach(async () => {
    service = jasmine.createSpyObj<PracticaService>('PracticaService', ['listar']);
    service.listar.and.returnValue(of(respuesta));
    await TestBed.configureTestingModule({
      imports: [PracticasListado], providers: [
        { provide: PracticaService, useValue: service },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(PracticasListado);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it('renders all seven states and dates without review actions or RUT', () => {
    const text = fixture.nativeElement.textContent;
    for (const item of respuesta.items) expect(text).toContain(item.estado.nombre);
    expect(text).toContain('Estudiante sintético');
    expect(text).toContain('Centro sintético');
    expect(text).toContain('17/10/2026, 09:30');
    expect(text).toContain('17/07/2026, 08:30');
    expect(text).toContain('Fecha no disponible');
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('ion-button')) as HTMLElement[];
    for (const action of ['Aprobar', 'Observar', 'Rechazar', 'Revisar antecedentes']) {
      expect(buttons.some(button => button.textContent?.includes(action))).toBeFalse();
    }
    expect(fixture.nativeElement.querySelector('input').type).toBe('text');
    expect(fixture.nativeElement.querySelector('input').getAttribute('autocomplete')).toBe('off');
  });

  it('loads without a filter and searches with exact RUT, resetting pagination', () => {
    expect(service.listar).toHaveBeenCalledWith(50, 0, undefined);
    component.offset = 100;
    component.rutBusqueda = '12345678-5';
    component.buscar();
    expect(service.listar).toHaveBeenCalledWith(50, 0, '12345678-5');
    expect(component.offset).toBe(0);
  });

  it('checks basic format without calculating the verifier', () => {
    service.listar.calls.reset();
    component.offset = 100;
    component.rutBusqueda = '12.345.678-5';
    component.buscar();
    expect(service.listar).not.toHaveBeenCalled();
    expect(component.error).toContain('sin puntos');
    expect(component.offset).toBe(0);
    component.rutBusqueda = '12345678-4';
    component.buscar();
    expect(service.listar).toHaveBeenCalledWith(50, 0, '12345678-4');
  });

  it('shows a safe 422 message without echoing backend input', () => {
    service.listar.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 422, error: { detail: [{ input: '12345678-4' }] }
    })));
    component.rutBusqueda = '12345678-4';
    component.buscar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('dígito verificador');
    expect(fixture.nativeElement.textContent).not.toContain('12345678-4');
    expect(component.items).toEqual([]);
  });

  it('clears the filter and returns to the first page', () => {
    component.rutBusqueda = '12345678-5'; component.buscar();
    component.siguiente(); component.limpiar();
    expect(service.listar).toHaveBeenCalledWith(50, 0, undefined);
    expect(component.rutBusqueda).toBe('');
    expect(component.offset).toBe(0);
  });

  it('paginates with the active filter and respects hay_mas', () => {
    component.rutBusqueda = '12345678-5'; component.buscar();
    component.siguiente();
    expect(service.listar).toHaveBeenCalledWith(50, 50, '12345678-5');
    component.anterior();
    expect(service.listar).toHaveBeenCalledWith(50, 0, '12345678-5');
    component.hayMas = false; service.listar.calls.reset(); component.siguiente(); component.anterior();
    expect(service.listar).not.toHaveBeenCalled();
  });

  it('shows empty results', () => {
    service.listar.and.returnValue(of({ items: [], limit: 50, offset: 0, hay_mas: false }));
    component.rutBusqueda = '12345678-5'; component.buscar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se encontraron prácticas');
  });

  it('shows loading, cancels obsolete requests and cleans up on destroy', () => {
    const old = new Subject<PracticasListadoResponse>();
    const latest = new Subject<PracticasListadoResponse>();
    service.listar.and.returnValues(old, latest);
    component.buscar(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-spinner')).not.toBeNull();
    component.rutBusqueda = '12345678-5'; component.buscar();
    old.next(respuesta); expect(component.items).toEqual([]);
    expect(old.observed).toBeFalse();
    latest.next({ ...respuesta, items: [] });
    expect(component.cargando).toBeFalse();
    component.ngOnDestroy(); expect(latest.observed).toBeFalse();
  });

  it('shows recoverable errors and retries', () => {
    service.listar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    component.buscar(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(component.cargando).toBeFalse();
    service.listar.and.returnValue(of(respuesta)); component.reintentar();
    expect(component.error).toBe(''); expect(component.items.length).toBe(7);
  });

  it('cancels an in-flight request even when the next search format is invalid', () => {
    const pending = new Subject<PracticasListadoResponse>();
    service.listar.and.returnValue(pending);
    component.buscar();
    component.rutBusqueda = 'invalid'; component.buscar();
    pending.next(respuesta);
    expect(pending.observed).toBeFalse();
    expect(component.items).toEqual([]);
    expect(component.cargando).toBeFalse();
    expect(component.error).toContain('sin puntos');
  });

  it('returns home without query parameters', () => {
    component.volver();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/home']);
  });

  it('retries the applied filter and failed page despite edited search text', () => {
    component.rutBusqueda = '12345678-5'; component.buscar();
    service.listar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    component.siguiente(); fixture.detectChanges();
    expect(component.offset).toBe(50);
    component.rutBusqueda = '10000013-K';
    service.listar.and.returnValue(of({ ...respuesta, offset: 50 }));
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('ion-button')) as HTMLElement[];
    buttons.find(button => button.textContent?.trim() === 'Reintentar')!.click();
    expect(service.listar).toHaveBeenCalledWith(50, 50, '12345678-5');
    expect(component.offset).toBe(50);
    expect(component.errorConsulta).toBeFalse();
  });

  it('retries an unfiltered request without applying a newly typed RUT', () => {
    service.listar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    component.siguiente();
    component.rutBusqueda = '12345678-5';
    service.listar.calls.reset();
    component.reintentar();
    expect(service.listar).toHaveBeenCalledOnceWith(50, 50, undefined);
  });

  it('indicates the applied filter without exposing its value and clears the indicator', () => {
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    component.rutBusqueda = '12345678-5'; component.buscar(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Filtro por estudiante aplicado');
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).not.toContain('12345678-5');
    component.rutBusqueda = ''; fixture.detectChanges();
    expect(component.filtroAplicado).toBeTrue();
    component.limpiar(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });

  it('does not offer an HTTP retry for local format errors', () => {
    component.rutBusqueda = 'invalid'; component.buscar(); fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('ion-button')) as HTMLElement[];
    expect(buttons.some(button => button.textContent?.trim() === 'Reintentar')).toBeFalse();
    service.listar.calls.reset(); component.reintentar();
    expect(service.listar).not.toHaveBeenCalled();
  });
  it('opens the selected practice detail without passing search data', () => {
    component.rutBusqueda = '12345678-5';
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('ion-button')) as HTMLElement[];
    const button = buttons.find(item => item.textContent?.trim() === 'Ver antecedentes')!;
    expect(button.getAttribute('aria-label')).toBe('Ver antecedentes de la práctica 1');
    button.click();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/practicas', 1]);
  });
});
