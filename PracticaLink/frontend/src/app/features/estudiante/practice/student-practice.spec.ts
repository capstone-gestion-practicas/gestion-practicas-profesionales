import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { ActualizarEstadoPracticaResponse, HistorialEstadoPractica, PracticaDetalleResponse } from '../../../core/models/practica.models';
import { AuthService } from '../../../core/services/auth.service';
import { PracticaService } from '../../../core/services/practica.service';
import { AuthStore } from '../../../core/store/auth.store';
import { StudentPractice } from './student-practice';

describe('StudentPractice', () => {
  let fixture: ComponentFixture<StudentPractice>;
  let component: StudentPractice;
  let authStore: AuthStore;
  let practicaService: jasmine.SpyObj<PracticaService>;
  let authService: jasmine.SpyObj<AuthService>;

  const contextoBase: ContextoUsuarioResponse = {
    usuario: { id_usuario: 7, nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.test' },
    roles: ['ESTUDIANTE'],
    perfil: { id_estudiante: 7, rut: '12345678-5', carrera: 'Ingeniería', sede: 'Santiago' },
    practica_actual: {
      id_practica: 15,
      estado: { id_estado: 3, nombre: 'OBSERVADA', es_final: false },
      centro_practica: { id_centro: 9, nombre: 'Empresa de prueba' },
      fecha_inicio: '2026-03-02', fecha_termino: null, horas: 360, horas_semanales: 30,
      cargo_funcion: 'Practicante',
    }
  };

  const detalle: PracticaDetalleResponse = {
    id_practica: 15,
    fecha_registro: '2026-02-01T10:00:00Z',
    estado: { id_estado: 3, nombre: 'OBSERVADA', es_final: false },
    centro_practica: {
      id_centro: 9, nombre: 'Empresa de prueba', rut_empresa: '76.123.456-7',
      direccion: 'Av. Central 123', telefono: '+56 9 1111 2222', correo: 'contacto@example.test',
      contacto_nombre: 'Patricia Soto', contacto_cargo: 'Encargada'
    },
    fecha_inicio: '2026-03-02', fecha_termino: '2026-06-30', horas: 360, horas_semanales: 30,
    cargo_funcion: 'Practicante TI', descripcion: 'Apoyo en desarrollo de sistemas'
  };

  const evento: HistorialEstadoPractica = {
    id_historial: 1, id_practica: 15, id_estado: 3, estado: 'OBSERVADA', es_final: false,
    id_usuario: 2, usuario: 'Gestora', fecha_cambio: '2026-03-01T12:00:00Z', observacion: 'Adjunta el documento corregido.'
  };

  function configurar(contexto: ContextoUsuarioResponse | null = contextoBase): void {
    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'obtenerMiPractica', 'obtenerHistorialEstados', 'responderObservacion'
    ]);
    authService = jasmine.createSpyObj<AuthService>('AuthService', ['obtenerContexto']);
    practicaService.obtenerMiPractica.and.returnValue(of(detalle));
    practicaService.obtenerHistorialEstados.and.returnValue(of([evento]));
    practicaService.responderObservacion.and.returnValue(of({ id_practica: 15, id_estado: 2, estado: 'EN_REVISION', mensaje: 'Respuesta enviada.' }));
    authService.obtenerContexto.and.returnValue(of(contextoBase));

    TestBed.configureTestingModule({
      imports: [StudentPractice],
      providers: [
        AuthStore,
        { provide: PracticaService, useValue: practicaService },
        { provide: AuthService, useValue: authService }
      ]
    });
    authStore = TestBed.inject(AuthStore);
    if (contexto) authStore.setContexto(contexto);
    fixture = TestBed.createComponent(StudentPractice);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('muestra antecedentes reales opcionales y el historial de la práctica coincidente', () => {
    configurar();
    const texto = fixture.nativeElement.textContent as string;
    expect(practicaService.obtenerMiPractica).toHaveBeenCalledTimes(1);
    expect(practicaService.obtenerHistorialEstados).toHaveBeenCalledOnceWith(15);
    expect(texto).toContain('Empresa de prueba');
    expect(texto).toContain('76.123.456-7');
    expect(texto).toContain('Patricia Soto');
    expect(texto).toContain('02/03/2026');
    expect(texto).toContain('360');
    expect(texto).toContain('30');
    expect(texto).toContain('Adjunta el documento corregido.');
  });

  it('no consulta si falta perfil y ofrece completar mediante evento', () => {
    configurar({ ...contextoBase, perfil: null });
    spyOn(component.solicitarCompletarPerfil, 'emit');
    expect(practicaService.obtenerMiPractica).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button').click();
    expect(component.solicitarCompletarPerfil.emit).toHaveBeenCalled();
  });

  it('sin práctica no carga detalle ni historial y ofrece registro mediante evento', () => {
    configurar({ ...contextoBase, practica_actual: null });
    spyOn(component.solicitarRegistroPractica, 'emit');
    expect(practicaService.obtenerMiPractica).not.toHaveBeenCalled();
    expect(practicaService.obtenerHistorialEstados).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button').click();
    expect(component.solicitarRegistroPractica.emit).toHaveBeenCalled();
  });

  it('rechaza mezclar el detalle de otro ID y no solicita historial', () => {
    configurar();
    practicaService.obtenerHistorialEstados.calls.reset();
    practicaService.obtenerMiPractica.and.returnValue(of({ ...detalle, id_practica: 99 }));
    component.reintentarDetalle();
    fixture.detectChanges();
    expect(component.detalle()).toBeNull();
    expect(component.errorCoherencia()).toContain('no coinciden');
    expect(practicaService.obtenerHistorialEstados).not.toHaveBeenCalled();
  });

  it('ignora respuesta obsoleta al cambiar el contexto a otra práctica', () => {
    const primera = new Subject<PracticaDetalleResponse>();
    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', ['obtenerMiPractica', 'obtenerHistorialEstados', 'responderObservacion']);
    practicaService.obtenerMiPractica.and.returnValues(primera, of({ ...detalle, id_practica: 22 }));
    practicaService.obtenerHistorialEstados.and.returnValue(of([]));
    authService = jasmine.createSpyObj<AuthService>('AuthService', ['obtenerContexto']);
    authService.obtenerContexto.and.returnValue(of(contextoBase));
    TestBed.configureTestingModule({
      imports: [StudentPractice],
      providers: [AuthStore, { provide: PracticaService, useValue: practicaService }, { provide: AuthService, useValue: authService }]
    });
    authStore = TestBed.inject(AuthStore);
    authStore.setContexto(contextoBase);
    fixture = TestBed.createComponent(StudentPractice);
    component = fixture.componentInstance;
    fixture.detectChanges();

    authStore.setContexto({ ...contextoBase, practica_actual: { ...contextoBase.practica_actual!, id_practica: 22 } });
    fixture.detectChanges();
    primera.next(detalle);
    fixture.detectChanges();
    expect(component.detalle()?.id_practica).toBe(22);
    expect(practicaService.obtenerHistorialEstados).toHaveBeenCalledOnceWith(22);
  });

  it('ofrece estados conocidos y fallback seguro para estado desconocido', () => {
    configurar();
    for (const estado of ['REGISTRADA', 'EN_REVISION', 'OBSERVADA', 'APROBADA', 'EN_CURSO', 'FINALIZADA', 'RECHAZADA']) {
      expect(component.mensajeEstado(estado)).toBeTruthy();
    }
    expect(component.mensajeEstado('NUEVO_ESTADO')).toContain('No pudimos identificar');
    expect(fixture.nativeElement.textContent).toContain('Observada');
  });

  it('muestra vacío y permite reintentar el historial', () => {
    configurar();
    practicaService.obtenerHistorialEstados.and.returnValues(
      throwError(() => new Error('offline')),
      of([])
    );
    component.reintentarDetalle();
    fixture.detectChanges();
    expect(component.errorHistorial()).toContain('No fue posible');
    fixture.nativeElement.querySelector('.student-practice__history button').click();
    fixture.detectChanges();
    expect(component.historial()).toEqual([]);
    expect(component.errorHistorial()).toBe('');
    expect(fixture.nativeElement.textContent).toContain('Aún no hay cambios de estado');
  });

  it('muestra error de detalle con acción de reintento', () => {
    configurar();
    practicaService.obtenerMiPractica.and.returnValues(throwError(() => new Error('offline')), of(detalle));
    component.reintentarDetalle();
    fixture.detectChanges();
    expect(component.errorDetalle()).toBeTruthy();
    fixture.nativeElement.querySelector('.student-card--warning button').click();
    fixture.detectChanges();
    expect(component.detalle()?.id_practica).toBe(15);
  });

  it('conserva el texto ante error de envío y no permite respuesta vacía', () => {
    configurar();
    component.respuestaObservacion = 'Texto que debe conservarse';
    practicaService.responderObservacion.and.returnValue(throwError(() => new Error('offline')));
    component.responderObservacion();
    expect(component.respuestaObservacion).toBe('Texto que debe conservarse');
    expect(component.errorEnvio()).toContain('se conservó');
    component.respuestaObservacion = '   ';
    component.responderObservacion();
    expect(practicaService.responderObservacion).toHaveBeenCalledTimes(1);
  });

  it('rechaza respuestas mayores a 500 y no inicia una escritura', () => {
    configurar();
    component.respuestaObservacion = 'x'.repeat(501);
    component.responderObservacion();
    expect(practicaService.responderObservacion).not.toHaveBeenCalled();
    expect(component.errorEnvio()).toContain('500 caracteres');
  });

  it('ignora la respuesta de envío obsoleta después de cambiar de práctica', () => {
    configurar();
    const solicitud = new Subject<ActualizarEstadoPracticaResponse>();
    practicaService.responderObservacion.and.returnValue(solicitud);
    component.respuestaObservacion = 'Respuesta para práctica A';
    component.responderObservacion();
    authStore.setContexto({
      ...contextoBase,
      practica_actual: { ...contextoBase.practica_actual!, id_practica: 22 }
    });
    fixture.detectChanges();
    solicitud.next({ id_practica: 15, id_estado: 2, estado: 'EN_REVISION', mensaje: 'Respuesta enviada.' });
    expect(component.mensajeExito()).toBe('');
    expect(authService.obtenerContexto).not.toHaveBeenCalled();
  });

  it('envía respuesta recortada, limita a 500 caracteres y recarga contexto', () => {
    configurar();
    component.respuestaObservacion = `  ${'x'.repeat(498)}  `;
    component.responderObservacion();
    expect(practicaService.responderObservacion).toHaveBeenCalledOnceWith(15, 'x'.repeat(498));
    expect(component.respuestaObservacion).toBe('');
    expect(component.mensajeExito()).toBe('Respuesta enviada.');
    expect(authService.obtenerContexto).toHaveBeenCalled();
    fixture.detectChanges();
    expect(practicaService.obtenerHistorialEstados).toHaveBeenCalled();
  });

  it('distingue el error de actualización posterior a una respuesta exitosa', () => {
    configurar();
    authService.obtenerContexto.and.returnValue(throwError(() => new Error('offline')));
    component.respuestaObservacion = 'Corregí lo solicitado';
    component.responderObservacion();
    expect(component.mensajeExito()).toBe('Respuesta enviada.');
    expect(component.errorActualizacion()).toContain('Tu respuesta fue enviada');
    expect(component.errorEnvio()).toBe('');
  });

  it('solo presenta el formulario de respuesta para OBSERVADA', () => {
    configurar({
      ...contextoBase,
      practica_actual: { ...contextoBase.practica_actual!, estado: { id_estado: 5, nombre: 'EN_CURSO', es_final: false } }
    });
    practicaService.obtenerMiPractica.and.returnValue(of({
      ...detalle, estado: { id_estado: 5, nombre: 'EN_CURSO', es_final: false }
    }));
    component.reintentarDetalle();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#observation-response')).toBeNull();
  });
});
