import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { IniciarPracticaResponse, PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { PracticaDetalle } from './practica-detalle';

describe('Inicio de práctica en detalle', () => {
  let fixture: ComponentFixture<PracticaDetalle>;
  let component: PracticaDetalle;
  let service: jasmine.SpyObj<PracticaService>;
  let roles: string[];
  let parametros: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const detalle: PracticaDetalleGestionResponse = {
    id_practica: 15, estudiante: { id_estudiante: 7, nombre: 'Estudiante sintético' },
    centro_practica: { id_centro: 9, nombre: 'Centro sintético' },
    fecha_registro: '2026-10-17T12:30:00Z',
    estado: { id_estado: 3, nombre: 'APROBADA', es_final: false },
    fecha_ultimo_cambio_estado: null, fecha_inicio: null, fecha_termino: null,
    horas: null, cargo_funcion: null, descripcion: null
  };
  const respuesta: IniciarPracticaResponse = {
    id_practica: 15, estado_anterior: { id_estado: 3, nombre: 'APROBADA' },
    estado: { id_estado: 4, nombre: 'EN_CURSO', es_final: false },
    fecha_ultimo_cambio_estado: '2026-10-17T15:00:00Z', id_historial: 90,
    mensaje: 'La práctica se inició correctamente'
  };
  beforeEach(async () => {
    roles = ['GESTOR'];
    service = jasmine.createSpyObj<PracticaService>('PracticaService', ['obtenerDetalle', 'obtenerHistorial', 'iniciar']);
    service.obtenerDetalle.and.returnValue(of(detalle));
    service.obtenerHistorial.and.returnValue(of({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false }));
    service.iniciar.and.returnValue(of(respuesta));
    parametros = new BehaviorSubject(convertToParamMap({ id: '15' }));
    await TestBed.configureTestingModule({ imports: [PracticaDetalle], providers: [
      { provide: PracticaService, useValue: service },
      { provide: AuthStore, useValue: { contexto: () => ({ roles }) } },
      { provide: ActivatedRoute, useValue: { paramMap: parametros } },
      { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) }
    ] }).compileComponents();
    fixture = TestBed.createComponent(PracticaDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  function button(label: string): HTMLElement | undefined {
    return Array.from(fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(item => item.textContent?.trim() === label);
  }

  it('shows only for management roles, approved and non-final', () => {
    for (const role of ['GESTOR', 'ADMINISTRADOR']) {
      roles = [role]; fixture.detectChanges();
      expect(button('Iniciar práctica')).toBeDefined();
    }
    roles = ['ESTUDIANTE']; fixture.detectChanges();
    expect(button('Iniciar práctica')).toBeUndefined();
    roles = ['GESTOR'];
    for (const nombre of ['REGISTRADA', 'EN_REVISION', 'OBSERVADA', 'EN_CURSO', 'FINALIZADA', 'RECHAZADA']) {
      component.detalle = { ...detalle, estado: { ...detalle.estado, nombre } };
      fixture.detectChanges(); expect(button('Iniciar práctica')).toBeUndefined();
    }
    component.detalle = { ...detalle, estado: { ...detalle.estado, es_final: true } };
    fixture.detectChanges(); expect(button('Iniciar práctica')).toBeUndefined();
  });

  it('requires explicit confirmation and supports cancellation without writing', () => {
    component.confirmarInicio(); expect(service.iniciar).not.toHaveBeenCalled();
    button('Iniciar práctica')!.click(); fixture.detectChanges();
    expect(button('Confirmar inicio')).toBeDefined();
    component.observacionInicio = 'Sintética';
    button('Cancelar')!.click(); fixture.detectChanges();
    expect(component.confirmandoInicio).toBeFalse();
    expect(component.observacionInicio).toBe('');
    expect(service.iniciar).not.toHaveBeenCalled();
  });

  it('validates normalized observation and sends only the approved destination', () => {
    component.solicitarInicio(); component.observacionInicio = 'a'.repeat(501);
    component.confirmarInicio(); expect(service.iniciar).not.toHaveBeenCalled();
    expect(component.errorInicio).toContain('500');
    component.observacionInicio = '  ' + '😀'.repeat(500) + '  ';
    component.confirmarInicio();
    expect(service.iniciar).toHaveBeenCalledWith('15', { estado: 'EN_CURSO', observacion: '😀'.repeat(500) });
  });

  it('prevents double sends and does not change state before server success', () => {
    const pending = new Subject<IniciarPracticaResponse>();
    service.iniciar.and.returnValue(pending);
    component.solicitarInicio(); component.confirmarInicio(); component.confirmarInicio();
    fixture.detectChanges();
    expect(service.iniciar).toHaveBeenCalledTimes(1);
    expect(service.iniciar).toHaveBeenCalledWith('15', { estado: 'EN_CURSO', observacion: null });
    expect(component.detalle?.estado.nombre).toBe('APROBADA');
    expect(component.mensajeInicio).toBe(''); expect(component.iniciando).toBeTrue();
    expect(button('Iniciando...')?.getAttribute('ng-reflect-disabled') === 'true'
      || (button('Iniciando...') as HTMLElement & { disabled: boolean }).disabled).toBeTrue();
    service.obtenerDetalle.calls.reset(); service.obtenerHistorial.calls.reset();
    service.obtenerDetalle.and.returnValue(of({ ...detalle, estado: respuesta.estado }));
    pending.next(respuesta); fixture.detectChanges();
    expect(component.mensajeInicio).toContain('correctamente');
    expect(component.detalle?.estado.nombre).toBe('EN_CURSO');
    expect(service.obtenerDetalle).toHaveBeenCalledWith('15');
    expect(service.obtenerHistorial).toHaveBeenCalledWith('15', 50, 0);
    expect(button('Iniciar práctica')).toBeUndefined();
  });

  it('refreshes detail and history after 409 without success message', () => {
    service.iniciar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    service.obtenerDetalle.calls.reset(); service.obtenerHistorial.calls.reset();
    component.solicitarInicio(); component.confirmarInicio();
    expect(component.errorInicio).toContain('conflicto'); expect(component.mensajeInicio).toBe('');
    expect(service.obtenerDetalle).toHaveBeenCalledWith('15');
    expect(service.obtenerHistorial).toHaveBeenCalledWith('15', 50, 0);
    expect(service.iniciar).toHaveBeenCalledTimes(1);
  });

  it('handles 503 and uncertain results with read-only consultation and no automatic retry', () => {
    for (const status of [503, 0, 500]) {
      service.iniciar.calls.reset(); service.obtenerDetalle.calls.reset(); service.obtenerHistorial.calls.reset();
      service.iniciar.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      component.solicitarInicio(); component.confirmarInicio(); fixture.detectChanges();
      expect(component.errorInicio).toContain(status === 503 ? 'no está disponible' : 'No se pudo confirmar');
      expect(component.mensajeInicio).toBe('');
      component.solicitarInicio(); component.confirmarInicio();
      expect(service.iniciar).toHaveBeenCalledTimes(1);
      expect(service.obtenerDetalle).not.toHaveBeenCalled();
      expect(service.obtenerHistorial).not.toHaveBeenCalled();
      button('Consultar nuevamente el estado')!.click();
      expect(service.obtenerDetalle).toHaveBeenCalledWith('15');
      expect(service.obtenerHistorial).toHaveBeenCalledWith('15', 50, 0);
      expect(service.iniciar).toHaveBeenCalledTimes(1);
    }
  });

  it('does not allow direct invocation by a student', () => {
    roles = ['ESTUDIANTE']; component.solicitarInicio(); component.confirmarInicio();
    expect(service.iniciar).not.toHaveBeenCalled();
  });

  it('ignores pending responses after changing practice', () => {
    const pending = new Subject<IniciarPracticaResponse>();
    service.iniciar.and.returnValue(pending);
    component.solicitarInicio(); component.confirmarInicio();
    parametros.next(convertToParamMap({ id: '16' }));
    expect(pending.observed).toBeFalse();
    pending.next(respuesta); expect(component.mensajeInicio).toBe('');
    expect(component.iniciando).toBeFalse(); expect(component.confirmandoInicio).toBeFalse();
  });
});
