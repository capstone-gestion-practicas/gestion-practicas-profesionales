import { AuthStore } from '../../core/store/auth.store';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { PracticaDetalle } from './practica-detalle';

describe('HU014 seguimientos persistidos', () => {
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

  const historial = {
    id_practica: 15, limit: 50, offset: 0, hay_mas: true,
    items: [
      { id_seguimiento: 9, fecha: '2026-07-01', tipo: null, observacion: '', responsable: { id_usuario: 8, nombre: 'Responsable inactivo' } },
      { id_seguimiento: 3, fecha: '2026-01-01', tipo: 'Antiguo', observacion: '<b>Texto</b>' + 'x'.repeat(2001), responsable: { id_usuario: 7, nombre: 'Responsable actual' } }
    ]
  };

  it('clears authentication and returns to login on 401', () => {
    const previous = sessionStorage.getItem('access_token');
    const clear = spyOn(TestBed.inject(AuthStore), 'limpiar').and.callThrough();
    const router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    try {
      sessionStorage.setItem('access_token', 'synthetic-token');
      service.obtenerSeguimientos.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
      component.cargarSeguimientos();
      expect(clear).toHaveBeenCalled();
      expect(sessionStorage.getItem('access_token')).toBeNull();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    } finally {
      if (previous !== null) sessionStorage.setItem('access_token', previous);
    }
  });

  it('renders server order, historical values and calendar dates', () => {
    service.obtenerSeguimientos.and.returnValue(of(historial));
    component.cargarSeguimientos(); fixture.detectChanges();
    expect(component.registrosSeguimiento.map(item => item.id_seguimiento)).toEqual([9, 3]);
    const text = fixture.nativeElement.textContent;
    for (const value of ['Medio no registrado', 'Responsable inactivo', '01/07/2026', '01/01/2026', historial.items[1].observacion]) expect(text).toContain(value);
    expect(fixture.nativeElement.querySelector('.history-observation b')).toBeNull();
  });

  it('shows empty only after successful response and prevents concurrent reads', () => {
    const pending = new Subject<typeof historial>();
    service.obtenerSeguimientos.and.returnValue(pending);
    service.obtenerSeguimientos.calls.reset();
    component.cargarSeguimientos(); component.cargarSeguimientos(); fixture.detectChanges();
    expect(service.obtenerSeguimientos).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Cargando seguimientos');
    expect(fixture.nativeElement.textContent).not.toContain('No hay seguimientos registrados');
    pending.next({ ...historial, items: [], hay_mas: false }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay seguimientos registrados para esta práctica');
  });

  it('paginates and retries the failed page only on request', () => {
    service.obtenerSeguimientos.and.returnValue(of(historial));
    component.cargarSeguimientos();
    service.obtenerSeguimientos.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    component.siguienteSeguimientos(); fixture.detectChanges();
    expect(service.obtenerSeguimientos).toHaveBeenCalledWith('15', 50, 50);
    const count = service.obtenerSeguimientos.calls.count();
    component.seleccionarVista('incidencias'); component.seleccionarVista('seguimientos');
    expect(service.obtenerSeguimientos.calls.count()).toBe(count);
    service.obtenerSeguimientos.and.returnValue(of({ ...historial, offset: 50, items: [], hay_mas: false }));
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('ion-button')) as HTMLElement[];
    buttons.find(button => button.textContent?.includes('Reintentar seguimientos'))!.click();
    fixture.detectChanges();
    expect(service.obtenerSeguimientos).toHaveBeenCalledWith('15', 50, 50);
    expect(fixture.nativeElement.textContent).toContain('No hay seguimientos en esta página');
    component.siguienteSeguimientos();
    expect(component.offsetSeguimientos).toBe(50);
    component.anteriorSeguimientos();
    expect(service.obtenerSeguimientos).toHaveBeenCalledWith('15', 50, 0);
  });

  for (const status of [403, 404, 422, 500, 503, 0]) {
    it(`handles ${status} without showing empty or local fallback`, () => {
      service.obtenerSeguimientos.and.returnValue(throwError(() => new HttpErrorResponse({ status, error: { detail: 'internal-secret' } })));
      component.cargarSeguimientos(); fixture.detectChanges();
      expect(component.errorSeguimientos).not.toBe('');
      expect(fixture.nativeElement.textContent).not.toContain('internal-secret');
      expect(fixture.nativeElement.textContent).not.toContain('No hay seguimientos registrados');
      expect(component.registrosSeguimiento).toEqual([]);
    });
  }

  it('clears and cancels stale responses on practice change and destruction', () => {
    const first = new Subject<typeof historial>();
    const second = new Subject<typeof historial>();
    service.obtenerSeguimientos.and.returnValues(first, second);
    component.cargarSeguimientos();
    parametros.next(convertToParamMap({ id: '16' }));
    expect(first.observed).toBeFalse();
    expect(component.registrosSeguimiento).toEqual([]);
    first.next(historial);
    expect(component.registrosSeguimiento).toEqual([]);
    second.next({ ...historial, id_practica: 16 });
    expect(component.registrosSeguimiento.length).toBe(2);
    fixture.destroy();
    expect(second.observed).toBeFalse();
  });

  it('ignores stored demonstration follow-ups and preserves incidences and storage', () => {
    const key = 'practicalink.registros-practica';
    const previous = localStorage.getItem(key);
    const stored = JSON.stringify([
      { id: 'demo', id_practica: '16', tipo: 'seguimiento', fecha: '2026-01-01', observaciones: 'Demo ignorada' },
      { id: 'incident', id_practica: '16', tipo: 'incidencia', fecha: '2026-01-01', descripcion: 'Incidencia conservada', estado: 'Pendiente' }
    ]);
    try {
      localStorage.setItem(key, stored);
      parametros.next(convertToParamMap({ id: '16' })); fixture.detectChanges();
      expect(component.registrosSeguimiento).toEqual([]);
      expect(fixture.nativeElement.textContent).not.toContain('Demo ignorada');
      component.seleccionarVista('incidencias'); fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Incidencia conservada');
      expect(localStorage.getItem(key)).toBe(stored);
    } finally {
      if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
    }
  });
});
