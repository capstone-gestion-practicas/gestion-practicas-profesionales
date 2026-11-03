import { PracticaDetalle } from '../practica-detalle/practica-detalle';
import { AuthStore } from '../../core/store/auth.store';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HttpResponse } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { RegistroPractica } from './registro-practica';
import { PracticaService } from '../../core/services/practica.service';
import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { IncidenciaResponse } from '../../core/models/incidencia.models';

const detalle = (id: number): PracticaDetalleGestionResponse => ({
  id_practica: id, estudiante: { id_estudiante: id, nombre: `Estudiante ${id}` },
  centro_practica: { id_centro: 1, nombre: 'Centro sintético' },
  estado: { id_estado: 1, nombre: 'EN_CURSO', es_final: false },
  fecha_registro: '2026-01-01T12:00:00Z', fecha_ultimo_cambio_estado: null,
  fecha_inicio: null, fecha_termino: null, horas: null, cargo_funcion: null, descripcion: null
});

describe('HU015 navegación con Router real', () => {
  let service: jasmine.SpyObj<PracticaService>;
  beforeEach(() => {
    service = jasmine.createSpyObj('PracticaService', ['obtenerDetalle', 'registrarIncidencia', 'obtenerSeguimientos', 'obtenerHistorial', 'obtenerIncidencias']);
    service.obtenerDetalle.and.callFake(id => of(detalle(Number(id))));
    service.registrarIncidencia.and.returnValue(new Subject<HttpResponse<IncidenciaResponse>>());
    TestBed.configureTestingModule({ providers: [
      provideRouter([{ path: 'practicas/:id', component: PracticaDetalle }, { path: 'practicas/:id/incidencias/nueva', component: RegistroPractica,
        data: { tipoRegistro: 'incidencia' } }]),
      { provide: PracticaService, useValue: service }
    ] });
  });

  it('returns after POST 201 and fetches the persisted list without injecting the POST body', async () => {
    const page = { id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false };
    service.obtenerSeguimientos.and.returnValue(of(page));
    service.obtenerHistorial.and.returnValue(of(page));
    service.obtenerIncidencias.and.returnValue(of(page));
    TestBed.inject(AuthStore).setContexto({
      usuario: { id_usuario: 101, nombre: 'Gestor', apellido: 'Sintético', correo: 'test@example.invalid' },
      roles: ['GESTOR'], perfil: null, practica_actual: null
    });
    service.registrarIncidencia.and.returnValue(of(new HttpResponse({ status: 201, body: {
      id_incidencia: 42, id_practica: 15, id_usuario: 101, tipo: 'SALUD',
      descripcion: 'Texto', estado: 'PENDIENTE', fecha: '2026-07-02T03:30:00Z'
    } as IncidenciaResponse })));
    const harness = await RouterTestingHarness.create();
    const form = await harness.navigateByUrl('/practicas/15/incidencias/nueva', RegistroPractica);
    form.tipoIncidencia = 'SALUD'; form.descripcionIncidencia = 'Texto'; form.guardar();
    expect(form.mensaje).toContain('Incidencia registrada correctamente');
    expect(service.obtenerIncidencias).not.toHaveBeenCalled();
    form.cancelar();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/practicas/15?vista=incidencias');
    expect(service.obtenerIncidencias).toHaveBeenCalledOnceWith('15', 50, 0);
    expect(harness.routeNativeElement?.textContent).toContain('No hay incidencias registradas');
    expect(harness.routeNativeElement?.textContent).not.toContain('Texto');
  });

  it('reuses the component but sends only to B and clears A state', async () => {
    const harness = await RouterTestingHarness.create();
    const a = await harness.navigateByUrl('/practicas/15/incidencias/nueva', RegistroPractica);
    a.mensaje = 'Confirmación A'; a.error = 'Error A'; a.incidenciaBloqueada = true;
    a.tipoIncidencia = 'OTRO'; a.descripcionIncidencia = 'Texto A';
    const b = await harness.navigateByUrl('/practicas/16/incidencias/nueva', RegistroPractica);
    expect(b).toBe(a);
    expect(b.idPractica).toBe('16');
    expect(b.detalle?.id_practica).toBe(16);
    expect(b.mensaje).toBe(''); expect(b.error).toBe('');
    expect(b.descripcionIncidencia).toBe(''); expect(b.incidenciaBloqueada).toBeFalse();
    b.tipoIncidencia = 'OTRO'; b.descripcionIncidencia = 'Texto B'; b.guardar();
    expect(service.registrarIncidencia).toHaveBeenCalledOnceWith('16', {
      tipo: 'OTRO', descripcion: 'Texto B'
    });
  });

  it('cancels pending A detail so it cannot overwrite B', async () => {
    const pending = new Subject<PracticaDetalleGestionResponse>();
    service.obtenerDetalle.and.callFake(id => id === '15' ? pending : of(detalle(16)));
    const harness = await RouterTestingHarness.create();
    const a = await harness.navigateByUrl('/practicas/15/incidencias/nueva', RegistroPractica);
    const b = await harness.navigateByUrl('/practicas/16/incidencias/nueva', RegistroPractica);
    expect(b).toBe(a); expect(pending.observed).toBeFalse();
    pending.next(detalle(15));
    expect(b.detalle?.id_practica).toBe(16);
    expect(b.cargando).toBeFalse();
  });

  it('cancels pending A submission and ignores its late error', async () => {
    const pending = new Subject<HttpResponse<IncidenciaResponse>>();
    service.registrarIncidencia.and.returnValue(pending);
    const harness = await RouterTestingHarness.create();
    const a = await harness.navigateByUrl('/practicas/15/incidencias/nueva', RegistroPractica);
    a.tipoIncidencia = 'OTRO'; a.descripcionIncidencia = 'Texto A'; a.guardar();
    const b = await harness.navigateByUrl('/practicas/16/incidencias/nueva', RegistroPractica);
    expect(b).toBe(a); expect(pending.observed).toBeFalse();
    pending.error(new Error('Error tardío A'));
    expect(b.guardando).toBeFalse(); expect(b.error).toBe(''); expect(b.mensaje).toBe('');
  });
});
