import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { PracticasListadoResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { PracticasListado } from './practicas-listado';

@Component({ standalone: true, template: '<p>Detalle de prueba</p>' })
class DetallePrueba {}

const respuesta: PracticasListadoResponse = {
  items: [{ id_practica: 15, estudiante: { id_estudiante: 7, nombre: 'Estudiante sintético' },
    centro_practica: 'Centro sintético', fecha_registro: '2026-01-01T12:00:00Z',
    estado: { id_estado: 5, nombre: 'EN_CURSO', es_final: false }, fecha_ultimo_cambio_estado: null,
    rut_estudiante: '11.111.111-1', fecha_inicio: '2026-03-01', fecha_termino: '2026-08-31',
    id_gestor: 9, gestor: 'Gestora sintética' }], limit: 50, offset: 0, hay_mas: true
};

describe('PracticasListado · filtros servidor e historial (4b)', () => {
  let harness: RouterTestingHarness;
  let service: jasmine.SpyObj<PracticaService>;
  let component: PracticasListado;
  let router: Router;
  const esperar = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
  };
  async function abrir(url = '/practicas'): Promise<void> {
    component = await harness.navigateByUrl(url, PracticasListado);
    harness.fixture.detectChanges();
  }
  beforeEach(async () => {
    service = jasmine.createSpyObj<PracticaService>('PracticaService', ['listar', 'obtenerResumenIncidenciasPendientes']);
    service.listar.and.returnValue(of(respuesta));
    service.obtenerResumenIncidenciasPendientes.and.returnValue(of({ items: [], limit: 100, offset: 0, hay_mas: false }));
    TestBed.configureTestingModule({ providers: [
      provideRouter([{ path: 'practicas', component: PracticasListado },
        { path: 'practicas/:id', component: DetallePrueba }]), provideLocationMocks(),
      { provide: PracticaService, useValue: service }
    ] });
    TestBed.inject(AuthStore).setContexto({ usuario: { id_usuario: 1, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.invalid' },
      roles: ['GESTOR'], perfil: null, practica_actual: null });
    router = TestBed.inject(Router);
    router.setUpLocationChangeListener();
    harness = await RouterTestingHarness.create();
  });

  it('restaura URL y consulta una sola vez con RUT, estado y offset', async () => {
    await abrir('/practicas?rut=12345678-5&estado=EN_CURSO&offset=100');
    expect(service.listar).toHaveBeenCalledOnceWith(50, 100, '12345678-5', 'EN_CURSO');
    expect(component.rutBusqueda).toBe('12345678-5');
    expect(component.estadoBusqueda).toBe('EN_CURSO');
    expect(component.offset).toBe(100);
  });

  it('aplica ambos filtros antes de paginar, reinicia página y no duplica consultas al sincronizar URL', async () => {
    await abrir('/practicas?offset=100');
    service.listar.calls.reset();
    component.rutBusqueda = '12345678-5';
    component.estadoBusqueda = 'EN_CURSO';
    component.buscar();
    await esperar();
    expect(service.listar).toHaveBeenCalledOnceWith(50, 0, '12345678-5', 'EN_CURSO');
    expect(router.url).toContain('estado=EN_CURSO');
    component.siguiente();
    await esperar();
    expect(service.listar).toHaveBeenCalledWith(50, 50, '12345678-5', 'EN_CURSO');
    expect(service.obtenerResumenIncidenciasPendientes).toHaveBeenCalledTimes(1);
  });

  it('el selector aplica estado y limpiar elimina ambos filtros y offset', async () => {
    await abrir('/practicas?rut=12345678-5&offset=50');
    const select = harness.routeNativeElement!.querySelector('select')!;
    select.value = 'APROBADA';
    select.dispatchEvent(new Event('change'));
    await esperar();
    expect(service.listar).toHaveBeenCalledWith(50, 0, '12345678-5', 'APROBADA');
    component.limpiar();
    await esperar();
    expect(router.url).toBe('/practicas');
    expect(component.offset).toBe(0);
    expect(component.estadoBusqueda).toBe('');
    expect(component.rutBusqueda).toBe('');
  });

  it('Atrás desde el detalle restaura filtros y página; Adelante recupera detalle', async () => {
    await abrir('/practicas?rut=12345678-5&estado=EN_CURSO&offset=50');
    component.verAntecedentes(15);
    await esperar();
    expect(router.url).toBe('/practicas/15?origen=practicas&rut=12345678-5&estado=EN_CURSO&offset=50');
    TestBed.inject(Location).back();
    await esperar();
    expect(router.url).toContain('offset=50');
    expect(service.listar).toHaveBeenCalledWith(50, 50, '12345678-5', 'EN_CURSO');
    TestBed.inject(Location).forward();
    await esperar();
    expect(router.url).toBe('/practicas/15?origen=practicas&rut=12345678-5&estado=EN_CURSO&offset=50');
  });

  it('cancela respuestas antiguas y evita envíos repetidos de los mismos filtros en vuelo', async () => {
    await abrir();
    const vieja = new Subject<PracticasListadoResponse>();
    const nueva = new Subject<PracticasListadoResponse>();
    service.listar.calls.reset();
    service.listar.and.returnValues(vieja, nueva);
    component.estadoBusqueda = 'APROBADA';
    component.buscar();
    component.buscar();
    expect(service.listar).toHaveBeenCalledTimes(1);
    await esperar();
    component.estadoBusqueda = 'EN_CURSO';
    component.buscar();
    await esperar();
    expect(vieja.observed).toBeFalse();
    vieja.next(respuesta);
    expect(component.items).toEqual([]);
    nueva.next({ ...respuesta, items: [] });
    harness.fixture.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('No se encontraron prácticas con los filtros aplicados');
  });

  it('muestra RUT, fechas calendario y gestor sin consultas por cada fila', async () => {
    await abrir();
    const texto = harness.routeNativeElement!.textContent!;
    for (const valor of ['11.111.111-1', '01/03/2026', '31/08/2026', 'Gestora sintética', 'En curso']) {
      expect(texto).toContain(valor);
    }
    expect(service.listar).toHaveBeenCalledTimes(1);
    expect(service.obtenerResumenIncidenciasPendientes).toHaveBeenCalledTimes(1);
  });

  it('reintenta la página y filtros aplicados, no los valores editados sin buscar', async () => {
    service.listar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await abrir('/practicas?rut=12345678-5&estado=APROBADA&offset=50');
    component.rutBusqueda = '10000013-K';
    component.estadoBusqueda = 'FINALIZADA';
    service.listar.calls.reset();
    service.listar.and.returnValue(of(respuesta));
    component.reintentar();
    expect(service.listar).toHaveBeenCalledOnceWith(50, 50, '12345678-5', 'APROBADA');
    // El cliente no filtra nuevamente la respuesta del servidor.
    expect(component.items).toEqual(respuesta.items);
  });

  it('conserva un estado desconocido válido recibido en URL y muestra el vacío del servidor', async () => {
    service.listar.and.returnValue(of({ ...respuesta, items: [], hay_mas: false }));
    await abrir('/practicas?estado=ARCHIVADA');
    expect(service.listar).toHaveBeenCalledOnceWith(50, 0, undefined, 'ARCHIVADA');
    expect(harness.routeNativeElement!.querySelector('select')!.value).toBe('ARCHIVADA');
    expect(harness.routeNativeElement!.textContent).toContain('No se encontraron prácticas con los filtros aplicados');
  });

  it('presenta fechas nulas sin desplazamiento horario y omite un gestor inexistente', async () => {
    service.listar.and.returnValue(of({ ...respuesta, items: [{ ...respuesta.items[0],
      fecha_inicio: null, fecha_termino: null, id_gestor: null, gestor: null }] }));
    await abrir();
    const texto = harness.routeNativeElement!.textContent!;
    expect(texto).toContain('No disponible');
    expect(texto).not.toContain('Gestor asignado');
  });

  for (const roles of [['GESTOR'], ['ADMINISTRADOR'], ['GESTOR', 'ADMINISTRADOR']]) {
    it(`${roles.join('+')}: muestra los datos autorizados por el servidor sin filtrado local`, async () => {
      const auth = TestBed.inject(AuthStore);
      auth.setContexto({ ...auth.contexto()!, roles });
      await abrir();
      expect(component.items).toEqual(respuesta.items);
      expect(service.listar).toHaveBeenCalledOnceWith(50, 0, undefined);
    });
  }
});
