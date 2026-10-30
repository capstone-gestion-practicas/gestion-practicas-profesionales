import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HttpResponse } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { RegistroPractica } from './registro-practica';
import { PracticaService } from '../../core/services/practica.service';
import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { SeguimientoResponse } from '../../core/models/seguimiento.models';

const detalle = (id: number): PracticaDetalleGestionResponse => ({
  id_practica: id, estudiante: { id_estudiante: id, nombre: `Estudiante ${id}` },
  centro_practica: { id_centro: 1, nombre: 'Centro sintético' },
  estado: { id_estado: 1, nombre: 'EN_CURSO', es_final: false },
  fecha_registro: '2026-01-01T12:00:00Z', fecha_ultimo_cambio_estado: null,
  fecha_inicio: null, fecha_termino: null, horas: null, cargo_funcion: null, descripcion: null
});

describe('HU013 navegación con Router real', () => {
  let service: jasmine.SpyObj<PracticaService>;
  beforeEach(() => {
    service = jasmine.createSpyObj('PracticaService', ['obtenerDetalle', 'registrarSeguimiento']);
    service.obtenerDetalle.and.callFake(id => of(detalle(Number(id))));
    service.registrarSeguimiento.and.returnValue(new Subject<HttpResponse<SeguimientoResponse>>());
    TestBed.configureTestingModule({ providers: [
      provideRouter([{ path: 'practicas/:id/seguimiento/nuevo', component: RegistroPractica,
        data: { tipoRegistro: 'seguimiento' } }]),
      { provide: PracticaService, useValue: service }
    ] });
  });

  it('reuses the component but sends only to B and clears A state', async () => {
    const harness = await RouterTestingHarness.create();
    const a = await harness.navigateByUrl('/practicas/15/seguimiento/nuevo', RegistroPractica);
    a.mensaje = 'Confirmación A'; a.error = 'Error A'; a.seguimientoBloqueado = true;
    a.tipoContacto = 'Otro'; a.observaciones = 'Texto A';
    const b = await harness.navigateByUrl('/practicas/16/seguimiento/nuevo', RegistroPractica);
    expect(b).toBe(a);
    expect(b.idPractica).toBe('16');
    expect(b.detalle?.id_practica).toBe(16);
    expect(b.mensaje).toBe(''); expect(b.error).toBe('');
    expect(b.observaciones).toBe(''); expect(b.seguimientoBloqueado).toBeFalse();
    b.tipoContacto = 'Otro'; b.observaciones = 'Texto B'; b.guardar();
    expect(service.registrarSeguimiento).toHaveBeenCalledOnceWith('16', {
      fecha: b.fecha, tipo: 'Otro', observacion: 'Texto B'
    });
  });

  it('cancels pending A detail so it cannot overwrite B', async () => {
    const pending = new Subject<PracticaDetalleGestionResponse>();
    service.obtenerDetalle.and.callFake(id => id === '15' ? pending : of(detalle(16)));
    const harness = await RouterTestingHarness.create();
    const a = await harness.navigateByUrl('/practicas/15/seguimiento/nuevo', RegistroPractica);
    const b = await harness.navigateByUrl('/practicas/16/seguimiento/nuevo', RegistroPractica);
    expect(b).toBe(a); expect(pending.observed).toBeFalse();
    pending.next(detalle(15));
    expect(b.detalle?.id_practica).toBe(16);
    expect(b.cargando).toBeFalse();
  });

  it('cancels pending A submission and ignores its late error', async () => {
    const pending = new Subject<HttpResponse<SeguimientoResponse>>();
    service.registrarSeguimiento.and.returnValue(pending);
    const harness = await RouterTestingHarness.create();
    const a = await harness.navigateByUrl('/practicas/15/seguimiento/nuevo', RegistroPractica);
    a.tipoContacto = 'Otro'; a.observaciones = 'Texto A'; a.guardar();
    const b = await harness.navigateByUrl('/practicas/16/seguimiento/nuevo', RegistroPractica);
    expect(b).toBe(a); expect(pending.observed).toBeFalse();
    pending.error(new Error('Error tardío A'));
    expect(b.guardando).toBeFalse(); expect(b.error).toBe(''); expect(b.mensaje).toBe('');
  });
});
