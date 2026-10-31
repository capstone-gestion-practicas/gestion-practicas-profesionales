import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
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
    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', ['obtenerDetalle']);
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

  it('saves a follow-up and returns to its practice detail', () => {
    fixture.componentInstance.tipoContacto = 'Videollamada';
    fixture.componentInstance.observaciones = 'Se revisaron los avances';
    fixture.componentInstance.proximaFecha = '2026-10-24';
    fixture.componentInstance.guardar();

    expect(registros.listar('15')[0]).toEqual(jasmine.objectContaining({
      tipo: 'seguimiento',
      tipo_contacto: 'Videollamada',
      observaciones: 'Se revisaron los avances',
      proxima_fecha: '2026-10-24'
    }));
    expect(router.navigate).toHaveBeenCalledWith(['/practicas', '15']);
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
