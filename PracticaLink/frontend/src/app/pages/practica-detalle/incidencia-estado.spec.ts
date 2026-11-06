import { NavController } from '@ionic/angular';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { IncidenciaEstado } from './incidencia-estado';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { IncidenciaEstadoResponse, IncidenciaEstadosHistorialResponse, IncidenciaHistorialItem } from '../../core/models/incidencia.models';

describe('HU016 gestión e historial', () => {
  let fixture: ComponentFixture<IncidenciaEstado>;
  let component: IncidenciaEstado;
  let service: jasmine.SpyObj<PracticaService>;
  let previousToken: string | null;
  const item: IncidenciaHistorialItem = {
    id_incidencia: 42, id_practica: 15, id_usuario: 101, tipo: 'SALUD', descripcion: 'Texto',
    estado: 'PENDIENTE', fecha: '2026-07-02T03:30:00Z', sin_tipo_registrado: false,
    fecha_resolucion: null, resolucion: null
  };
  const page: IncidenciaEstadosHistorialResponse = {
    id_practica: 15, id_incidencia: 42, limit: 50, offset: 0, hay_mas: false,
    items: [{ id_historial: 1, id_usuario: 101, estado_anterior: null,
      estado_nuevo: 'PENDIENTE', fecha: item.fecha, comentario: null }]
  };
  const response: IncidenciaEstadoResponse = {
    id_practica: 15, id_incidencia: 42, id_usuario: 101, id_historial: 2,
    estado_anterior: 'PENDIENTE', estado_nuevo: 'EN_ATENCION', comentario: null,
    fecha: '2026-07-03T12:00:00Z'
  };

  beforeEach(async () => {
    previousToken = sessionStorage.getItem('access_token');
    service = jasmine.createSpyObj('PracticaService', ['obtenerHistorialIncidencia', 'cambiarEstadoIncidencia']);
    service.obtenerHistorialIncidencia.and.returnValue(of(page));
    service.cambiarEstadoIncidencia.and.returnValue(new Subject<HttpResponse<IncidenciaEstadoResponse>>());
    await TestBed.configureTestingModule({ imports: [IncidenciaEstado], providers: [
      { provide: PracticaService, useValue: service },
      { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      { provide: NavController, useValue: jasmine.createSpyObj('NavController', ['navigateRoot']) }
    ] }).compileComponents();
    TestBed.inject(AuthStore).setContexto({
      usuario: { id_usuario: 101, nombre: 'Gestor', apellido: 'Sintético', correo: 'test@example.com' },
      roles: ['GESTOR'], perfil: null, practica_actual: null
    });
    fixture = TestBed.createComponent(IncidenciaEstado);
    fixture.componentRef.setInput('practica', '15');
    fixture.componentRef.setInput('incidencia', { ...item });
    fixture.detectChanges();
    component = fixture.componentInstance;
  });
  afterEach(() => {
    fixture.destroy();
    if (previousToken === null) sessionStorage.removeItem('access_token');
    else sessionStorage.setItem('access_token', previousToken);
  });

  it('offers direct resolution and attention with real initial trace', () => {
    expect(component.transiciones).toEqual(['EN_ATENCION', 'RESUELTA']);
    expect(service.obtenerHistorialIncidencia).toHaveBeenCalledWith('15', '42', 50, 0);
    expect(fixture.nativeElement.textContent).toContain('01/07/2026, 23:30');
    expect(fixture.nativeElement.textContent).toContain('Sin estado anterior');
    expect(fixture.nativeElement.textContent).toContain('Usuario #101');
  });

  for (const role of ['ADMINISTRADOR', 'ESTUDIANTE']) {
    it('uses current role ' + role, () => {
      const auth = TestBed.inject(AuthStore);
      auth.setContexto({ ...auth.contexto()!, roles: [role] });
      service.obtenerHistorialIncidencia.calls.reset();
      component.ngOnChanges(); fixture.detectChanges();
      expect(service.obtenerHistorialIncidencia.calls.count()).toBe(role === 'ADMINISTRADOR' ? 1 : 0);
      expect(component.transiciones.length).toBe(role === 'ADMINISTRADOR' ? 2 : 0);
      if (role === 'ESTUDIANTE') expect(fixture.nativeElement.querySelector('form')).toBeNull();
    });
  }

  it('offers only resolution for EN_ATENCION and no action for RESUELTA', () => {
    service.obtenerHistorialIncidencia.and.returnValue(of({ ...page, items: [
      { ...page.items[0], id_historial: 2, estado_anterior: 'PENDIENTE', estado_nuevo: 'EN_ATENCION' }, ...page.items
    ] }));
    fixture.componentRef.setInput('incidencia', { ...item, estado: 'EN_ATENCION' }); fixture.detectChanges();
    expect(component.transiciones).toEqual(['RESUELTA']);
    fixture.componentRef.setInput('incidencia', { ...item, estado: 'RESUELTA', fecha_resolucion: response.fecha }); fixture.detectChanges();
    expect(component.transiciones).toEqual([]);
  });

  it('keeps incompatible historical data read-only without restricting display', () => {
    const historical = { ...page.items[0], estado_nuevo: 'ABIERTA', comentario: '<b>Texto</b>' + 'x'.repeat(2001), fecha: 'infinity' };
    service.obtenerHistorialIncidencia.and.returnValue(of({ ...page, items: [historical] }));
    fixture.componentRef.setInput('incidencia', { ...item, tipo: null, sin_tipo_registrado: true, estado: 'ABIERTA' });
    fixture.detectChanges();
    expect(component.transiciones).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain(historical.comentario);
    expect(fixture.nativeElement.textContent).toContain('infinity');
    expect(fixture.nativeElement.querySelector('.comentario b')).toBeNull();
  });

  it('requires a coherent initial chain even for modern-looking rows', () => {
    service.obtenerHistorialIncidencia.and.returnValue(of({ ...page, items: [] }));
    component.ngOnChanges(); fixture.detectChanges();
    expect(component.transiciones).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('No hay cambios de estado registrados');
    service.obtenerHistorialIncidencia.and.returnValue(of({ ...page, items: [page.items[0], page.items[0]] }));
    component.ngOnChanges();
    expect(component.transiciones).toEqual([]);
  });

  it('rejects unsafe BIGINT identifiers without rounding a request', () => {
    service.obtenerHistorialIncidencia.calls.reset();
    fixture.componentRef.setInput('incidencia', { ...item, id_incidencia: Number.MAX_SAFE_INTEGER + 1 });
    fixture.detectChanges();
    expect(service.obtenerHistorialIncidencia).not.toHaveBeenCalled();
    expect(component.error).toContain('precisión');
    expect(component.transiciones).toEqual([]);
  });

  it('waits for 200, prevents duplicate PATCH and requests GET refresh without mutating the item', () => {
    const pending = new Subject<HttpResponse<IncidenciaEstadoResponse>>();
    service.cambiarEstadoIncidencia.and.returnValue(pending);
    const refresh = spyOn(component.recargar, 'emit');
    component.destino = 'EN_ATENCION'; component.comentario = '   ';
    component.guardar(); component.guardar();
    expect(service.cambiarEstadoIncidencia).toHaveBeenCalledOnceWith('15', '42', {
      estado_esperado: 'PENDIENTE', estado_nuevo: 'EN_ATENCION', comentario: null
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(component.incidencia.estado).toBe('PENDIENTE');
    pending.next(new HttpResponse({ status: 200, body: response }));
    expect(refresh).toHaveBeenCalledWith('Cambio de estado confirmado. Se está actualizando el listado.');
    expect(component.incidencia.estado).toBe('PENDIENTE');
    component.guardar(); expect(service.cambiarEstadoIncidencia).toHaveBeenCalledTimes(1);
  });

  it('requires resolution content and counts Unicode code points after btrim', () => {
    component.destino = 'RESUELTA';
    for (const value of ['', '   ', '\t\n', 'x'.repeat(2001)]) {
      component.comentario = value; component.guardar();
      expect(component.errorCambio).not.toBe('');
    }
    expect(service.cambiarEstadoIncidencia).not.toHaveBeenCalled();
    component.comentario = '  ' + '😀'.repeat(2000) + '  '; component.guardar();
    expect(service.cambiarEstadoIncidencia).toHaveBeenCalledWith('15', '42', {
      estado_esperado: 'PENDIENTE', estado_nuevo: 'RESUELTA', comentario: '😀'.repeat(2000)
    });
  });

  for (const status of [409, 0, 500, 503]) {
    it('refreshes uncertain/conflicting result ' + status + ' without retry or success', () => {
      const refresh = spyOn(component.recargar, 'emit');
      service.cambiarEstadoIncidencia.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      component.destino = 'EN_ATENCION'; component.guardar(); component.guardar();
      expect(service.cambiarEstadoIncidencia).toHaveBeenCalledTimes(1);
      expect(component.bloqueado).toBeTrue();
      expect(refresh).toHaveBeenCalled();
      expect(refresh.calls.mostRecent().args[0]).not.toContain('Cambio de estado confirmado');
      expect(component.incidencia.estado).toBe('PENDIENTE');
    });
  }

  for (const status of [401, 403, 404, 422]) {
    it('handles PATCH ' + status + ' without exposing internal errors', () => {
      service.cambiarEstadoIncidencia.and.returnValue(throwError(() => new HttpErrorResponse({ status, error: 'internal-secret' })));
      component.destino = 'EN_ATENCION'; component.guardar();
      expect(component.errorCambio).not.toBe('');
      expect(component.errorCambio).not.toContain('internal-secret');
      if (status === 401) expect(TestBed.inject(NavController).navigateRoot).toHaveBeenCalledWith(['/login']);
    });
  }

  it('treats non-200 or mismatched confirmation as uncertain', () => {
    const refresh = spyOn(component.recargar, 'emit');
    service.cambiarEstadoIncidencia.and.returnValue(of(new HttpResponse({ status: 201, body: response })));
    component.destino = 'EN_ATENCION'; component.guardar();
    expect(refresh.calls.mostRecent().args[0]).toContain('No se pudo validar');
  });

  it('paginates in received order and retries a failed page manually', () => {
    service.obtenerHistorialIncidencia.and.returnValue(of({ ...page, hay_mas: true,
      items: [{ ...page.items[0], id_historial: 2 }, page.items[0]] }));
    component.ngOnChanges();
    expect(component.eventos.map(e => e.id_historial)).toEqual([2, 1]);
    service.obtenerHistorialIncidencia.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    component.siguiente(); fixture.detectChanges();
    expect(service.obtenerHistorialIncidencia).toHaveBeenCalledWith('15', '42', 50, 50);
    expect(component.consultado).toBeFalse();
    const calls = service.obtenerHistorialIncidencia.calls.count();
    expect(fixture.nativeElement.textContent).not.toContain('No hay cambios de estado registrados');
    service.obtenerHistorialIncidencia.and.returnValue(of({ ...page, offset: 50, items: [] }));
    Array.from(fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(e => e.textContent?.includes('Reintentar historial'))!.click();
    expect(service.obtenerHistorialIncidencia.calls.count()).toBe(calls + 1);
    component.anterior(); expect(service.obtenerHistorialIncidencia).toHaveBeenCalledWith('15', '42', 50, 0);
  });

  it('clears and cancels old reads/writes on selection change', () => {
    const read = new Subject<IncidenciaEstadosHistorialResponse>();
    service.obtenerHistorialIncidencia.and.returnValue(read);
    component.ngOnChanges();
    component.cargar(); expect(read.observed).toBeTrue();
    service.obtenerHistorialIncidencia.and.returnValue(of(page));
    fixture.componentRef.setInput('incidencia', { ...item }); fixture.detectChanges();
    expect(read.observed).toBeFalse();
    const write = new Subject<HttpResponse<IncidenciaEstadoResponse>>();
    service.cambiarEstadoIncidencia.and.returnValue(write);
    const refresh = spyOn(component.recargar, 'emit');
    component.destino = 'EN_ATENCION'; component.guardar();
    service.obtenerHistorialIncidencia.and.returnValue(of({ ...page, id_practica: 16, id_incidencia: 43, items: [] }));
    fixture.componentRef.setInput('practica', '16');
    fixture.componentRef.setInput('incidencia', { ...item, id_practica: 16, id_incidencia: 43 });
    fixture.detectChanges();
    expect(write.observed).toBeFalse();
    write.next(new HttpResponse({ status: 200, body: response }));
    expect(refresh).not.toHaveBeenCalled();
    expect(component.eventos).toEqual([]);
    expect(component.comentario).toBe(''); expect(component.errorCambio).toBe('');
    expect(component.guardando).toBeFalse();
  });

  it('does not access localStorage and cancels requests on destruction', () => {
    const get = spyOn(localStorage, 'getItem');
    const set = spyOn(localStorage, 'setItem');
    const remove = spyOn(localStorage, 'removeItem');
    const pending = new Subject<IncidenciaEstadosHistorialResponse>();
    service.obtenerHistorialIncidencia.and.returnValue(pending);
    component.cargar(); fixture.destroy();
    expect(pending.observed).toBeFalse();
    expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
});
