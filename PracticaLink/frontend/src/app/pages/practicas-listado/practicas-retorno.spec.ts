import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { PracticaDetalleGestionResponse, PracticasListadoResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { DocenteService } from '../../features/docente/docente.service';
import { PracticaDetalle } from '../practica-detalle/practica-detalle';
import { PracticasListado } from './practicas-listado';

@Component({ standalone: true, template: '<p>Estados</p>' })
class EstadosPrueba {}

const listado: PracticasListadoResponse = {
  items: [{ id_practica: 15, estudiante: { id_estudiante: 7, nombre: 'Estudiante sintético' },
    centro_practica: 'Centro sintético', fecha_registro: '2026-01-01T12:00:00Z',
    estado: { id_estado: 4, nombre: 'APROBADA', es_final: false }, fecha_ultimo_cambio_estado: null,
    rut_estudiante: '11.111.111-1', fecha_inicio: null, fecha_termino: null, id_gestor: 1, gestor: 'Cuenta sintética' }],
  limit: 50, offset: 100, hay_mas: false
};
const detalle: PracticaDetalleGestionResponse = {
  ...listado.items[0], centro_practica: { id_centro: 9, nombre: 'Centro sintético' },
  horas: null, cargo_funcion: null, descripcion: null
};

describe('Listado → detalle real → listado: retorno seguro', () => {
  let harness: RouterTestingHarness;
  let router: Router;
  let service: jasmine.SpyObj<PracticaService>;
  const urlListado = '/practicas?rut=12345678-5&estado=APROBADA&offset=100';

  async function esperar(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
  }

  function volver(): void {
    const boton = Array.from(harness.routeNativeElement!.querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(elemento => elemento.textContent?.trim() === '← Volver a prácticas');
    expect(boton).toBeDefined();
    boton!.click();
  }

  beforeEach(async () => {
    service = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'listar', 'obtenerResumenIncidenciasPendientes', 'obtenerDetalle', 'obtenerHistorial', 'obtenerSeguimientos'
    ]);
    service.listar.and.returnValue(of(listado));
    service.obtenerResumenIncidenciasPendientes.and.returnValue(of({ items: [], limit: 100, offset: 0, hay_mas: false }));
    service.obtenerDetalle.and.returnValue(of(detalle));
    service.obtenerHistorial.and.returnValue(of({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false }));
    service.obtenerSeguimientos.and.returnValue(of({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false }));
    const docentes = jasmine.createSpyObj<DocenteService>('DocenteService', ['consultarAsignacion']);
    docentes.consultarAsignacion.and.returnValue(of({ id_practica: 15, docente_actual: null, docentes_disponibles: [] }));
    TestBed.configureTestingModule({ providers: [
      provideRouter([{ path: 'practicas', component: PracticasListado },
        { path: 'practicas/:id', component: PracticaDetalle }, { path: 'gestion-estados', component: EstadosPrueba }]),
      provideLocationMocks(), AuthStore,
      { provide: PracticaService, useValue: service }, { provide: DocenteService, useValue: docentes }
    ] });
    TestBed.inject(AuthStore).setContexto({ usuario: { id_usuario: 1, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.invalid' },
      roles: ['GESTOR'], perfil: null, practica_actual: null });
    router = TestBed.inject(Router);
    router.setUpLocationChangeListener();
    harness = await RouterTestingHarness.create();
  });

  for (const roles of [['GESTOR'], ['ADMINISTRADOR'], ['GESTOR', 'ADMINISTRADOR']]) {
    it(`${roles.join('+')}: botón vuelve conservando RUT, estado y página aplicados`, async () => {
      const auth = TestBed.inject(AuthStore);
      auth.setContexto({ ...auth.contexto()!, roles });
      const component = await harness.navigateByUrl(urlListado, PracticasListado);
      harness.fixture.detectChanges();
      // El texto escrito sin buscar no debe viajar como origen aplicado.
      component.rutBusqueda = '10000013-K';
      const boton = harness.routeNativeElement!.querySelector('ion-button[expand="block"]')!;
      expect(boton.textContent?.trim()).toBe('Ver detalle de práctica');
      expect(boton.getAttribute('aria-label')).toBe('Ver detalle de práctica 15');
      (boton as HTMLElement).click();
      await esperar();
      expect(router.url).toContain('/practicas/15?origen=practicas');
      service.listar.calls.reset();
      volver();
      await esperar();
      expect(router.url).toBe(urlListado);
      expect(service.listar).toHaveBeenCalledOnceWith(50, 100, '12345678-5', 'APROBADA');
    });
  }

  it('detalle abierto directamente regresa a /practicas sin filtros', async () => {
    await harness.navigateByUrl('/practicas/15', PracticaDetalle);
    harness.fixture.detectChanges();
    volver();
    await esperar();
    expect(router.url).toBe('/practicas');
  });

  it('desde Estados regresa al listado seguro, no hereda filtros ajenos', async () => {
    await harness.navigateByUrl('/gestion-estados?estado=APROBADA');
    await harness.navigateByUrl('/practicas/15?origen=gestion-estados&estado=APROBADA', PracticaDetalle);
    harness.fixture.detectChanges();
    volver();
    await esperar();
    expect(router.url).toBe('/practicas');
  });

  for (const origen of ['https://example.invalid', '//example.invalid', '/usuarios']) {
    it(`no navega al destino arbitrario ${origen}`, async () => {
      await harness.navigateByUrl(`/practicas/15?origen=${encodeURIComponent(origen)}&estado=APROBADA`, PracticaDetalle);
      harness.fixture.detectChanges();
      volver();
      await esperar();
      expect(router.url).toBe('/practicas');
    });
  }

  it('Atrás y Adelante conservan el origen antes y después del regreso por botón', async () => {
    const component = await harness.navigateByUrl(urlListado, PracticasListado);
    component.verAntecedentes(15);
    await esperar();
    const urlDetalle = router.url;
    TestBed.inject(Location).back();
    await esperar();
    expect(router.url).toBe(urlListado);
    TestBed.inject(Location).forward();
    await esperar();
    expect(router.url).toBe(urlDetalle);
    volver();
    await esperar();
    expect(router.url).toBe(urlListado);
    TestBed.inject(Location).back();
    await esperar();
    expect(router.url).toBe(urlDetalle);
    TestBed.inject(Location).forward();
    await esperar();
    expect(router.url).toBe(urlListado);
  });
});
