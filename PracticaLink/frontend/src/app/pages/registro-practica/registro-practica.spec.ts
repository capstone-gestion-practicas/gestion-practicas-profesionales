import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { SeguimientoResponse, hoySantiago, fechaSeguimientoValida } from '../../core/models/seguimiento.models';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { RegistroPracticaService } from '../../core/services/registro-practica.service';
import { RegistroPractica } from './registro-practica';

describe('RegistroPractica', () => {
  let fixture: ComponentFixture<RegistroPractica>;
  let practicaService: jasmine.SpyObj<PracticaService>;
  let routeStub: { snapshot: { data: Record<string, string>; paramMap: ReturnType<typeof convertToParamMap> } };
  let router: jasmine.SpyObj<Router>;
  let registros: RegistroPracticaService;
  const detalle: PracticaDetalleGestionResponse = {
    id_practica: 15,
    estudiante: { id_estudiante: 7, nombre: 'Estudiante de prueba' },
    centro_practica: { id_centro: 9, nombre: 'Centro de prueba' },
    fecha_registro: '2026-10-17T12:30:00Z',
    estado: { id_estado: 3, nombre: 'EN_CURSO', es_final: false },
    fecha_ultimo_cambio_estado: null,
    fecha_inicio: '2026-08-01',
    fecha_termino: null,
    horas: 360,
    cargo_funcion: 'Desarrollo',
    descripcion: null
  };

  beforeEach(async () => {
    localStorage.removeItem('practicalink.registros-practica');
    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', ['obtenerDetalle', 'registrarSeguimiento']);
    practicaService.obtenerDetalle.and.returnValue(of(detalle));
    routeStub = {
      snapshot: {
        data: { tipoRegistro: 'seguimiento' },
        paramMap: convertToParamMap({ id: '15' })
      }
    };
    await TestBed.configureTestingModule({
      imports: [RegistroPractica],
      providers: [
        provideRouter([]),
        { provide: PracticaService, useValue: practicaService },
        { provide: ActivatedRoute, useValue: routeStub }
      ]
    }).compileComponents();
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    spyOn(router, 'navigate');
    registros = TestBed.inject(RegistroPracticaService);
    fixture = TestBed.createComponent(RegistroPractica);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.removeItem('practicalink.registros-practica');
  });

  it('requires the mandatory follow-up fields', () => {
    fixture.componentInstance.guardar();
    expect(fixture.componentInstance.error).toContain('campos obligatorios');
    expect(registros.listar('15')).toEqual([]);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  function completar(): void {
    fixture.componentInstance.tipoContacto = 'Videollamada';
    fixture.componentInstance.observaciones = ' Se revisaron los avances ';
  }

  it('waits for 201, prevents duplicate sends and never writes follow-ups locally', () => {
    completar();
    const pendiente = new Subject<HttpResponse<SeguimientoResponse>>();
    practicaService.registrarSeguimiento.and.returnValue(pendiente);
    const guardarLocal = spyOn(registros, 'guardar');
    const escribir = spyOn(localStorage, 'setItem');
    fixture.componentInstance.guardar();
    fixture.componentInstance.guardar();
    expect(practicaService.registrarSeguimiento).toHaveBeenCalledOnceWith('15', {
      fecha: hoySantiago(), tipo: 'Videollamada', observacion: ' Se revisaron los avances '
    });
    expect(fixture.componentInstance.guardando).toBeTrue();
    expect(fixture.componentInstance.mensaje).toBe('');
    pendiente.next(new HttpResponse({ status: 201, body: {
      fecha: hoySantiago(), tipo: 'Videollamada', observacion: ' Se revisaron los avances ',
      id_practica: 15, id_usuario: 101, id_seguimiento: 1, fecha_creacion: '2026-01-01T12:00:00Z'
    } }));
    pendiente.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('registrado correctamente');
    expect(fixture.componentInstance.guardando).toBeFalse();
    fixture.componentInstance.guardar();
    expect(practicaService.registrarSeguimiento).toHaveBeenCalledTimes(1);
    expect(guardarLocal).not.toHaveBeenCalled();
    expect(escribir).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  for (const status of [401, 403, 404, 409, 422, 500, 503, 0]) {
    it(`handles HTTP ${status} without local fallback or automatic retry`, () => {
      completar();
      practicaService.registrarSeguimiento.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      const escribir = spyOn(localStorage, 'setItem');
      fixture.componentInstance.guardar();
      expect(fixture.componentInstance.error).not.toBe('');
      expect(fixture.componentInstance.mensaje).toBe('');
      expect(fixture.componentInstance.guardando).toBeFalse();
      expect(practicaService.registrarSeguimiento).toHaveBeenCalledTimes(1);
      expect(escribir).not.toHaveBeenCalled();
      expect(fixture.componentInstance.seguimientoBloqueado).toBe([0, 500, 503].includes(status));
    });
  }

  it('rejects invalid dates, future dates, media, blank and oversized observations', () => {
    completar();
    for (const fecha of ['2099-01-01', '2026-02-30', '2026-01-01T00:00:00Z']) {
      fixture.componentInstance.fecha = fecha;
      fixture.componentInstance.guardar();
    }
    fixture.componentInstance.fecha = hoySantiago();
    fixture.componentInstance.tipoContacto = 'invalid';
    fixture.componentInstance.guardar();
    fixture.componentInstance.tipoContacto = 'Otro';
    for (const texto of ['   ', '📝'.repeat(2001)]) {
      fixture.componentInstance.observaciones = texto;
      fixture.componentInstance.guardar();
    }
    expect(practicaService.registrarSeguimiento).not.toHaveBeenCalled();
  });

  it('uses Santiago calendar at summer and winter UTC boundaries', () => {
    expect(hoySantiago(new Date('2026-01-02T02:30:00Z'))).toBe('2026-01-01');
    expect(hoySantiago(new Date('2026-07-02T03:30:00Z'))).toBe('2026-07-01');
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date('2026-07-02T03:30:00Z'));
      expect(fechaSeguimientoValida('2026-07-02')).toBeFalse();
      expect(fechaSeguimientoValida('2026-07-01')).toBeTrue();
    } finally { jasmine.clock().uninstall(); }
  });

  it('does not announce success for an unexpected HTTP success code', () => {
    completar();
    practicaService.registrarSeguimiento.and.returnValue(of(new HttpResponse<SeguimientoResponse>({ status: 200 })));
    fixture.componentInstance.guardar();
    expect(fixture.componentInstance.mensaje).toBe('');
    expect(fixture.componentInstance.seguimientoBloqueado).toBeTrue();
  });

  it('saves an incidence with its initial status', () => {
    routeStub.snapshot.data = { tipoRegistro: 'incidencia' };
    fixture.destroy();
    fixture = TestBed.createComponent(RegistroPractica);
    fixture.detectChanges();
    fixture.componentInstance.descripcionIncidencia = 'Falta de asignación de tareas';
    fixture.componentInstance.estadoIncidencia = 'Pendiente';
    fixture.componentInstance.guardar();

    expect(registros.listar('15')[0]).toEqual(jasmine.objectContaining({
      tipo: 'incidencia',
      descripcion: 'Falta de asignación de tareas',
      estado: 'Pendiente'
    }));
    expect(router.navigate).toHaveBeenCalledWith(['/practicas', '15']);
  });
});
