import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import {
  PracticaIncidenciasPendientesItem,
  PracticasListadoResponse,
  ResumenIncidenciasPendientesResponse
} from '../../core/models/practica.models';
import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { PracticasListado } from './practicas-listado';

const gestor: ContextoUsuarioResponse = {
  usuario: { id_usuario: 101, nombre: 'Gestor', apellido: 'Sintético', correo: 'gestor@example.com' },
  roles: ['GESTOR'], perfil: null, practica_actual: null
};

function practica(id: number, nombre = 'EN_CURSO') {
  return {
    id_practica: id, estudiante: { id_estudiante: 1, nombre: 'Estudiante sintético' },
    centro_practica: 'Centro sintético', fecha_registro: '2026-10-17T12:30:00Z',
    estado: { id_estado: 1, nombre, es_final: nombre === 'FINALIZADA' },
    fecha_ultimo_cambio_estado: null
  };
}

function pendiente(id: number, pendientes = 3, enGestion = 1,
                   fecha = '2026-10-20T15:10:00Z'): PracticaIncidenciasPendientesItem {
  return { id_practica: id, pendientes, en_atencion: enGestion, fecha_pendiente_antigua: fecha };
}

function resumen(items: PracticaIncidenciasPendientesItem[], hayMas = false, limit = 100, offset = 0):
  ResumenIncidenciasPendientesResponse {
  return { items, limit, offset, hay_mas: hayMas };
}

describe('PracticasListado · resumen HU017', () => {
  let fixture: ComponentFixture<PracticasListado>;
  let component: PracticasListado;
  let service: jasmine.SpyObj<PracticaService>;
  let auth: AuthStore;
  let listado: PracticasListadoResponse;

  function texto(): string {
    return fixture.nativeElement.textContent;
  }

  function crear(): void {
    fixture = TestBed.createComponent(PracticasListado);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    listado = {
      items: [practica(1, 'EN_CURSO'), practica(2, 'FINALIZADA'), practica(3, 'EN_CURSO')],
      limit: 50, offset: 0, hay_mas: true
    };
    service = jasmine.createSpyObj<PracticaService>('PracticaService',
      ['listar', 'obtenerResumenIncidenciasPendientes']);
    service.listar.and.returnValue(of(listado));
    service.obtenerResumenIncidenciasPendientes.and.returnValue(of(resumen([pendiente(1), pendiente(2, 1, 0)])));
    await TestBed.configureTestingModule({
      imports: [PracticasListado], providers: [
        { provide: PracticaService, useValue: service },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) }
      ]
    }).compileComponents();
    auth = TestBed.inject(AuthStore);
    auth.setContexto(gestor);
  });

  afterEach(() => fixture?.destroy());

  // ---------- llamadas y estrategia sin N+1 ----------
  it('calls the summary once with pagination only and never per practice', () => {
    crear();
    expect(service.obtenerResumenIncidenciasPendientes).toHaveBeenCalledTimes(1);
    expect(service.obtenerResumenIncidenciasPendientes).toHaveBeenCalledWith(100, 0);
    expect(service.listar).toHaveBeenCalledTimes(1);
  });

  it('keeps the summary request when moving to another page', () => {
    crear();
    component.siguiente();
    expect(service.listar).toHaveBeenCalledWith(50, 50, undefined);
    expect(service.obtenerResumenIncidenciasPendientes).toHaveBeenCalledTimes(1);
  });

  it('keeps the summary request when searching by RUT and still matches by id', () => {
    crear();
    component.rutBusqueda = '12345678-5';
    component.buscar();
    expect(service.listar).toHaveBeenCalledWith(50, 0, '12345678-5');
    expect(service.obtenerResumenIncidenciasPendientes).toHaveBeenCalledTimes(1);
    expect(texto()).toContain('Pendientes: 3');
  });

  it('combines several summary pages without duplicates', () => {
    const primera = Array.from({ length: 100 }, (_, i) => pendiente(i + 1, 1, 0, `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`));
    service.obtenerResumenIncidenciasPendientes.and.callFake((_l: number, offset: number) =>
      of(offset === 0 ? resumen(primera, true) : resumen([pendiente(101, 4, 0)], false, 100, 100)));
    crear();
    expect(service.obtenerResumenIncidenciasPendientes.calls.allArgs()).toEqual([[100, 0], [100, 100]]);
    expect(component.pendientesDe(101)).toBe(4);
    expect(component.pendientesDe(1)).toBe(1);
  });

  // ---------- presentación ----------
  it('shows pendientes and en gestion as separate values', () => {
    crear();
    expect(texto()).toContain('Pendientes: 3');
    expect(texto()).toContain('En gestión: 1');
    expect(component.pendientesDe(1)).toBe(3);
    expect(component.enGestionDe(1)).toBe(1);
  });

  it('treats a practice missing from a successful summary as zero', () => {
    crear();
    expect(component.resumenEstado).toBe('listo');
    expect(component.pendientesDe(3)).toBe(0);
    expect(component.enGestionDe(3)).toBe(0);
  });

  it('shows finalized practices with pending incidences', () => {
    crear();
    const finalizada = fixture.nativeElement.querySelectorAll('ion-card')[1] as HTMLElement;
    expect(finalizada.textContent).toContain('FINALIZADA');
    expect(finalizada.textContent).toContain('Pendientes: 1');
  });

  it('marks zero pending visibly and keeps the value', () => {
    service.obtenerResumenIncidenciasPendientes.and.returnValue(of(resumen([])));
    crear();
    const badge = fixture.nativeElement.querySelector('.badge-pendiente') as HTMLElement;
    expect(badge.textContent).toContain('Pendientes: 0');
    expect(badge.classList).toContain('sin-pendientes');
  });

  it('formats the oldest pending date in America/Santiago without changing the value', () => {
    crear();
    expect(component.fechaPendienteDe(1)).toBe('2026-10-20T15:10:00Z');
    expect(texto()).toContain('Pendiente desde 20/10/2026, 12:10');
  });

  it('shows no date when the summary has no entry for the practice', () => {
    crear();
    expect(component.fechaPendienteDe(3)).toBeNull();
  });

  it('empty summary response gives zero for every visible practice after success', () => {
    service.obtenerResumenIncidenciasPendientes.and.returnValue(of(resumen([])));
    crear();
    expect(component.resumenEstado).toBe('listo');
    expect(texto()).not.toContain('Incidencias no disponibles');
    expect(texto()).toContain('Pendientes: 0');
  });

  it('shows loading while the summary is in flight', () => {
    const pendienteRespuesta = new Subject<ResumenIncidenciasPendientesResponse>();
    service.obtenerResumenIncidenciasPendientes.and.returnValue(pendienteRespuesta.asObservable());
    crear();
    expect(texto()).toContain('Cargando incidencias');
    expect(texto()).not.toContain('Pendientes: 0');
    pendienteRespuesta.next(resumen([pendiente(1)]));
    pendienteRespuesta.complete();
    fixture.detectChanges();
    expect(texto()).toContain('Pendientes: 3');
  });

  // ---------- errores ----------
  it('summary failure keeps the practice list and never shows zeros', () => {
    service.obtenerResumenIncidenciasPendientes.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 503 })));
    crear();
    expect(component.resumenEstado).toBe('error');
    expect(texto()).toContain('Estudiante sintético');
    expect(texto()).toContain('Incidencias no disponibles');
    expect(texto()).not.toContain('Pendientes: 0');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('No fue posible cargar las incidencias pendientes');
  });

  it('summary authorization failure shows a specific message', () => {
    service.obtenerResumenIncidenciasPendientes.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 403 })));
    crear();
    expect(component.resumenError).toBe('No tienes autorización para consultar incidencias pendientes.');
  });

  it('manual retry requests the summary again and recovers', () => {
    service.obtenerResumenIncidenciasPendientes.and.returnValues(
      throwError(() => new HttpErrorResponse({ status: 500 })),
      of(resumen([pendiente(1)])));
    crear();
    expect(component.resumenEstado).toBe('error');
    const boton = Array.from(fixture.nativeElement.querySelectorAll('ion-button')) as HTMLElement[];
    expect(boton.some(b => b.textContent?.includes('Reintentar incidencias'))).toBeTrue();
    component.reintentarResumen();
    fixture.detectChanges();
    expect(service.obtenerResumenIncidenciasPendientes).toHaveBeenCalledTimes(2);
    expect(component.resumenEstado).toBe('listo');
    expect(texto()).toContain('Pendientes: 3');
  });

  it('inconsistent summary pages are an error, not zeros', () => {
    const malformed: ResumenIncidenciasPendientesResponse[] = [
      resumen([pendiente(1)], false, 50, 0),              // limit distinto
      resumen([pendiente(1)], false, 100, 10),            // offset distinto
      resumen([pendiente(1, 0)]),                         // pendientes = 0
      resumen([pendiente(1, 1, -1)]),                     // contador negativo
      resumen([pendiente(1), pendiente(1)]),              // id duplicado
      resumen([{ ...pendiente(1), fecha_pendiente_antigua: 'no-es-fecha' }]),
      resumen([pendiente(1)], true)                       // hay_mas sin página completa
    ];
    for (const data of malformed) {
      service.obtenerResumenIncidenciasPendientes.and.returnValue(of(data));
      crear();
      expect(component.resumenEstado).toBe('error');
      expect(texto()).not.toContain('Pendientes: 0');
      fixture.destroy();
    }
  });

  it('unsafe BIGINT identifiers are not matched and show unavailable, not zero', () => {
    const inseguro = Number.MAX_SAFE_INTEGER + 2;
    listado.items = [practica(inseguro)];
    service.obtenerResumenIncidenciasPendientes.and.returnValue(of(resumen([])));
    crear();
    expect(component.identificadorSeguro(inseguro)).toBeFalse();
    expect(texto()).toContain('Incidencias no disponibles');
    expect(texto()).not.toContain('Pendientes: 0');
  });

  // ---------- permisos ----------
  it('does not request the summary for roles other than GESTOR or ADMINISTRADOR', () => {
    auth.setContexto({ ...gestor, roles: ['ESTUDIANTE'] });
    crear();
    expect(service.obtenerResumenIncidenciasPendientes).not.toHaveBeenCalled();
    expect(component.resumenEstado).toBe('inactivo');
    expect(texto()).not.toContain('Pendientes:');
  });

  it('ADMINISTRADOR may view the summary', () => {
    auth.setContexto({ ...gestor, roles: ['ADMINISTRADOR'] });
    crear();
    expect(service.obtenerResumenIncidenciasPendientes).toHaveBeenCalledTimes(1);
    expect(texto()).toContain('Pendientes: 3');
  });

  // ---------- regresiones y seguridad de datos ----------
  it('keeps the existing listing behaviour and does not use localStorage', () => {
    const getItem = spyOn(Storage.prototype, 'getItem').and.callThrough();
    const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
    crear();
    expect(service.listar).toHaveBeenCalledWith(50, 0, undefined);
    expect(texto()).toContain('Estudiante sintético');
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('keeps summary state after a listing error', () => {
    service.listar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    crear();
    expect(component.error).toContain('No fue posible cargar las prácticas');
    expect(component.resumenEstado).toBe('listo');
  });
});
