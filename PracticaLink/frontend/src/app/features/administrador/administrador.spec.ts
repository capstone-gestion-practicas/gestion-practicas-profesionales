import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthStore } from '../../core/store/auth.store';
import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { muestraEspacioAdministrador } from '../../core/navigation/espacio-administrador';
import { SesionService } from '../../core/session/sesion.service';
import { SolicitudesPendientesService } from '../../core/services/solicitudes-pendientes.service';
import { NotificacionService } from '../notificaciones/services/notificacion.service';
import { GestorLayout } from '../gestor/layout/gestor-layout';
import { OperacionAcademica } from './operacion-academica';
import { SupervisionAdmin } from './supervision-admin';
import { seccionAdmin } from './layout/admin-layout';

const contexto = (roles: string[]): ContextoUsuarioResponse => ({
  usuario: { id_usuario: 1, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.invalid' },
  roles, perfil: null, practica_actual: null
});

@Component({ standalone: true, imports: [OperacionAcademica, SupervisionAdmin],
  template: `<p>Consulta de práctica</p><app-supervision-admin />
    <app-operacion-academica><button type="button">Operación conservada</button></app-operacion-academica>` })
class PaginaPrueba {}

describe('Administración · navegación y separación de responsabilidades', () => {
  let harness: RouterTestingHarness;
  let auth: AuthStore;
  const salir = jasmine.createSpy('cerrar');
  const nodo = (): HTMLElement => harness.routeNativeElement as HTMLElement;

  beforeEach(() => {
    sessionStorage.clear(); salir.calls.reset();
    TestBed.configureTestingModule({ providers: [
      provideRouter([
        { path: 'espacios', component: PaginaPrueba },
        { path: '', component: GestorLayout, children:
          ['home', 'usuarios', 'gestion-estados', 'practicas', 'seguimientos', 'incidencias', 'notificaciones', 'envio-notificaciones']
            .map(path => ({ path, component: PaginaPrueba })) }
      ]),
      AuthStore, { provide: SesionService, useValue: { cerrar: salir } },
      { provide: NotificacionService, useValue: { noLeidas: signal(3) } },
      { provide: SolicitudesPendientesService, useValue: { total: signal(null), refrescar: jasmine.createSpy('refrescar') } }
    ] });
    auth = TestBed.inject(AuthStore);
  });
  afterEach(() => sessionStorage.clear());

  for (const roles of [['ADMINISTRADOR'], ['ADMINISTRADOR', 'GESTOR']]) {
    it(`mantiene layout y los cinco destinos para ${roles.join('+')}`, async () => {
      auth.setContexto(contexto(roles));
      harness = await RouterTestingHarness.create('/home');
      const layout = nodo().querySelector('app-admin-layout');
      expect(layout).not.toBeNull();
      expect(nodo().querySelector('app-gestor-header')).toBeNull();
      const links = Array.from(nodo().querySelectorAll('.gh-nav__enlace'));
      expect(links.map(link => link.textContent?.trim())).toEqual(['Inicio', 'Usuarios', 'Asignaciones', 'Supervisión', 'Comunicaciones']);
      expect(links.map(link => link.getAttribute('href'))).toEqual(['/home', '/usuarios', '/gestion-estados', '/practicas', '/envio-notificaciones']);
      for (const ruta of ['/usuarios', '/gestion-estados?estado=APROBADA', '/seguimientos', '/incidencias', '/notificaciones', '/envio-notificaciones']) {
        await harness.navigateByUrl(ruta); harness.detectChanges();
        expect(nodo().querySelector('app-admin-layout')).toBe(layout);
        expect(nodo().querySelector('.gh-nav__enlace[aria-current="page"]')?.textContent?.trim() ?? null).toBe(seccionAdmin(ruta));
        expect(nodo().textContent).toContain('Consulta de práctica');
      }
    });
  }

  it('mantiene la consulta visible y las operaciones conservadas plegadas solo para administración', async () => {
    auth.setContexto(contexto(['ADMINISTRADOR']));
    harness = await RouterTestingHarness.create('/practicas');
    const detalle = nodo().querySelector('app-operacion-academica details') as HTMLDetailsElement;
    expect(detalle.open).toBeFalse();
    expect(detalle.querySelector('button')?.textContent).toBe('Operación conservada');
    expect(nodo().querySelector('[aria-label="Consultas de supervisión"]')?.querySelectorAll('button').length).toBe(3);
    detalle.querySelector('summary')?.click();
    expect(detalle.open).toBeTrue();
  });

  it('menú móvil, cuenta, bandeja, cambio de espacio y cierre de sesión funcionan', async () => {
    auth.setContexto(contexto(['ADMINISTRADOR', 'GESTOR']));
    harness = await RouterTestingHarness.create('/home');
    const movil = nodo().querySelector('.gh-menu') as HTMLButtonElement;
    expect(nodo().textContent).not.toContain('Cambiar espacio');
    expect(nodo().querySelector('.gh-herramientas > a[href="/espacios"]')).toBeNull();
    movil.click(); harness.detectChanges();
    expect(movil.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); harness.detectChanges();
    expect(movil.getAttribute('aria-expanded')).toBe('false');
    (nodo().querySelector('.gh-cuenta__alternar') as HTMLButtonElement).click(); harness.detectChanges();
    expect(nodo().querySelector('#admin-cuenta-menu')?.textContent).toContain('cuenta@example.invalid');
    (nodo().querySelector('#admin-cuenta-menu button') as HTMLButtonElement).click();
    expect(salir).toHaveBeenCalledTimes(1);
    const bandeja = nodo().querySelector('a[href="/notificaciones"]') as HTMLAnchorElement;
    expect(bandeja.textContent).toContain('(3)');
    bandeja.click(); await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/notificaciones');
    harness.detectChanges();
    expect(nodo().querySelector('.gh-nav__enlace[aria-current="page"]')).toBeNull();
    expect(nodo().querySelector('a[href="/notificaciones"]')?.getAttribute('aria-current')).toBe('page');
    (nodo().querySelector('.gh-cuenta__alternar') as HTMLButtonElement).click(); harness.detectChanges();
    expect(nodo().querySelectorAll('a[href="/espacios"]').length).toBe(1);
    (nodo().querySelector('a[href="/espacios"]') as HTMLAnchorElement).click(); await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/espacios');
  });

  it('no convierte una selección guardada en permisos y permite ambos espacios multirrol', () => {
    sessionStorage.setItem('practicalink-workspace', 'ADMINISTRADOR');
    for (const roles of [[], ['GESTOR'], ['DOCENTE'], ['ESTUDIANTE']]) {
      expect(muestraEspacioAdministrador(contexto(roles))).toBeFalse();
    }
    expect(muestraEspacioAdministrador(contexto(['GESTOR', 'ADMINISTRADOR']))).toBeTrue();
    sessionStorage.setItem('practicalink-workspace', 'GESTOR');
    expect(muestraEspacioAdministrador(contexto(['GESTOR', 'ADMINISTRADOR']))).toBeFalse();
    expect(muestraEspacioAdministrador(contexto(['ADMINISTRADOR']))).toBeTrue();
  });

  it('la bandeja personal no selecciona Comunicaciones, pero el envío institucional sí', () => {
    expect(seccionAdmin('/notificaciones?filtro=no_leidas')).toBeNull();
    expect(seccionAdmin('/envio-notificaciones')).toBe('Comunicaciones');
  });

  it('multirrol puede regresar desde GESTOR al selector sin cambiar la interfaz del gestor exclusivo', async () => {
    sessionStorage.setItem('practicalink-workspace', 'GESTOR');
    auth.setContexto(contexto(['GESTOR', 'ADMINISTRADOR']));
    harness = await RouterTestingHarness.create('/home');
    expect(nodo().querySelector('app-admin-layout')).toBeNull();
    const cambio = Array.from(nodo().querySelectorAll('app-gestor-header button'))
      .find(boton => boton.textContent?.trim() === 'Cambiar espacio') as HTMLButtonElement;
    expect(cambio).toBeDefined(); cambio.click(); await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/espacios');
  });
});
