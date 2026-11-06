import { Location } from '@angular/common';
import { Component, WritableSignal, OnInit, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { IonContent, NavController, provideIonicAngular } from '@ionic/angular';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { SolicitudesPendientesService } from '../../../core/services/solicitudes-pendientes.service';
import { AuthStore } from '../../../core/store/auth.store';
import { NotificacionService } from '../../notificaciones/services/notificacion.service';
import { GestorLayout } from './gestor-layout';

@Component({
  selector: 'app-pagina-prueba',
  standalone: true,
  template: '<p class="pagina-prueba">Contenido del módulo</p>'
})
class PaginaPrueba {}

/** Página con ion-content y contenido más alto que su contenedor, para medir el scroll interno. */
@Component({
  selector: 'app-pagina-alta',
  standalone: true,
  imports: [IonContent],
  template: '<ion-content><div class="bloque-alto" style="height: 300vh"></div></ion-content>'
})
class PaginaAlta {}

/** Inicio anidado: cuenta cada creación de instancia, como la recarga de datos al volver a /home. */
let instanciasInicio = 0;

@Component({
  selector: 'app-inicio-prueba',
  standalone: true,
  template: '<p class="inicio-prueba">Inicio</p>'
})
class InicioPrueba implements OnInit {
  ngOnInit(): void {
    instanciasInicio++;
  }
}

const rutas: Routes = [
  { path: 'usuarios', component: PaginaPrueba },
  {
    path: '',
    component: GestorLayout,
    children: [
      { path: 'home', component: InicioPrueba },
      { path: 'alta', component: PaginaAlta },
      { path: 'revisiones', component: PaginaPrueba },
      { path: 'revisiones/:id', component: PaginaPrueba },
      { path: 'gestion-estados', component: PaginaPrueba },
      { path: 'seguimientos', component: PaginaPrueba },
      { path: 'incidencias', component: PaginaPrueba },
      { path: 'envio-notificaciones', component: PaginaPrueba },
      { path: 'practicas/:id', component: PaginaPrueba },
      { path: 'notificaciones', component: PaginaPrueba }
    ]
  },
  { path: '**', redirectTo: 'home' }
];

describe('GestorLayout', () => {
  let harness: RouterTestingHarness;
  let authStore: AuthStore;
  let router: Router;
  let navController: jasmine.SpyObj<NavController>;
  let pendientes: WritableSignal<number | null>;
  let refrescar: jasmine.Spy;

  const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Demo', correo: 'gestor@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  const elementoRuta = (): HTMLElement => harness.routeNativeElement as HTMLElement;

  const cabeceras = (): HTMLElement[] =>
    Array.from(document.querySelectorAll('app-gestor-header') as NodeListOf<HTMLElement>);

  const seccionActiva = (): string | null =>
    elementoRuta().querySelector('.gh-nav__enlace[aria-current="page"]')?.textContent?.trim() ?? null;

  const hojaMasProfunda = (): ActivatedRouteSnapshot => {
    let nodo = router.routerState.snapshot.root;
    while (nodo.firstChild) {
      nodo = nodo.firstChild;
    }
    return nodo;
  };

  async function crear(roles: string[]): Promise<void> {
    authStore.setContexto(contextoCon(roles));
    harness = await RouterTestingHarness.create();
    // El harness no instala la escucha de popstate; sin ella el botón Atrás del navegador no llega al router.
    router.setUpLocationChangeListener();
  }

  async function irA(url: string): Promise<void> {
    await harness.navigateByUrl(url);
    harness.fixture.detectChanges();
  }

  beforeEach(() => {
    // Overlays de Ionic que otras suites pueden dejar en el documento: robarían el foco de estas pruebas.
    document.querySelectorAll('ion-modal, ion-overlay').forEach(overlay => overlay.remove());
    instanciasInicio = 0;
    pendientes = signal<number | null>(3);
    refrescar = jasmine.createSpy('refrescar');
    TestBed.configureTestingModule({
      providers: [
        provideIonicAngular(),
        provideRouter(rutas),
        provideLocationMocks(),
        AuthStore,
        {
          provide: NotificacionService,
          useValue: { noLeidas: signal(0) }
        },
        {
          provide: SolicitudesPendientesService,
          useValue: { total: pendientes, refrescar }
        },
        {
          provide: NavController,
          useValue: jasmine.createSpyObj<NavController>('NavController', ['navigateRoot'])
        }
      ]
    });
    authStore = TestBed.inject(AuthStore);
    router = TestBed.inject(Router);
    navController = TestBed.inject(NavController) as jasmine.SpyObj<NavController>;
    sessionStorage.setItem('access_token', 'test-token');
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('gestor sin administración', () => {
    beforeEach(async () => {
      await crear(['GESTOR']);
    });

    it('muestra una sola cabecera en sus módulos', async () => {
      await irA('/revisiones');
      expect(elementoRuta().querySelectorAll('app-gestor-header').length).toBe(1);
      expect(cabeceras().length).toBe(1);
      expect(elementoRuta().querySelector('.pagina-prueba')).not.toBeNull();
    });

    it('marca la sección activa según la URL, incluido el detalle de solicitud', async () => {
      await irA('/revisiones/5');
      expect(seccionActiva()).toBe('Solicitudes');
      await irA('/gestion-estados');
      expect(seccionActiva()).toBe('Estados');
      await irA('/seguimientos');
      expect(seccionActiva()).toBe('Seguimientos');
      await irA('/incidencias');
      expect(seccionActiva()).toBe('Incidencias');
    });

    it('conserva la misma instancia de cabecera al cambiar de módulo', async () => {
      await irA('/revisiones');
      const primera = elementoRuta().querySelector('app-gestor-header');
      await irA('/incidencias');
      const segunda = elementoRuta().querySelector('app-gestor-header');
      expect(segunda).toBe(primera);
      expect(elementoRuta().querySelector('.pagina-prueba')).not.toBeNull();
    });

    it('conserva los query params de la URL directa', async () => {
      await irA('/gestion-estados?estado=EN_CURSO');
      expect(router.url).toBe('/gestion-estados?estado=EN_CURSO');
      expect(hojaMasProfunda().queryParamMap.get('estado')).toBe('EN_CURSO');
    });

    it('vuelve al módulo anterior con el historial del navegador', async () => {
      await irA('/revisiones');
      await irA('/incidencias');
      expect(router.url).toBe('/incidencias');
      TestBed.inject(Location).back();
      await new Promise(resolve => setTimeout(resolve, 0));
      await harness.fixture.whenStable();
      expect(router.url).toBe('/revisiones');
    });

    it('cierra sesión desde el menú de cuenta con la limpieza centralizada', async () => {
      await irA('/revisiones');
      (elementoRuta().querySelector('.gh-cuenta__alternar') as HTMLButtonElement).click();
      harness.fixture.detectChanges();
      const cerrar = Array.from(elementoRuta().querySelectorAll('button'))
        .find(boton => boton.textContent?.trim() === 'Cerrar sesión');
      cerrar?.click();
      expect(sessionStorage.getItem('access_token')).toBeNull();
      expect(navController.navigateRoot).toHaveBeenCalledWith(['/login']);
    });

    it('muestra las seis secciones del sidebar con sus etiquetas', async () => {
      await irA('/revisiones');
      const etiquetas = Array.from(elementoRuta().querySelectorAll('.gh-nav__enlace'))
        .map(boton => boton.textContent?.trim());
      expect(etiquetas).toEqual(['Inicio', 'Solicitudes', 'Estados', 'Seguimientos', 'Incidencias', 'Avisos']);
      expect(elementoRuta().querySelector('.gh-sidebar')).not.toBeNull();
    });

    it('Avisos queda activo en /envio-notificaciones', async () => {
      await irA('/envio-notificaciones');
      expect(seccionActiva()).toBe('Avisos');
    });

    it('navega con el router desde el sidebar sin recargar la aplicación', async () => {
      await irA('/revisiones');
      const botonEstados = Array.from(elementoRuta().querySelectorAll('.gh-nav__enlace'))
        .find(boton => boton.textContent?.trim() === 'Estados') as HTMLButtonElement;
      botonEstados.click();
      await harness.fixture.whenStable();
      expect(router.url).toBe('/gestion-estados');
      harness.fixture.detectChanges();
      expect(seccionActiva()).toBe('Estados');
    });

    it('abre notificaciones desde la campana', async () => {
      await irA('/revisiones');
      const navegar = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      (elementoRuta().querySelector('.gh-campana') as HTMLButtonElement).click();
      expect(navegar).toHaveBeenCalledWith(['/notificaciones']);
    });

    it('Escape cierra el menú de cuenta y devuelve el foco a su botón', async () => {
      await irA('/revisiones');
      const alternar = elementoRuta().querySelector('.gh-cuenta__alternar') as HTMLButtonElement;
      alternar.click();
      harness.fixture.detectChanges();
      expect(alternar.getAttribute('aria-expanded')).toBe('true');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      harness.fixture.detectChanges();
      expect(alternar.getAttribute('aria-expanded')).toBe('false');
      expect(elementoRuta().querySelector('.gh-cuenta__menu')).toBeNull();
    });

    it('muestra el contador real de solicitudes por revisar', async () => {
      await irA('/revisiones');
      const contador = elementoRuta().querySelector('.gh-nav__contador') as HTMLElement;
      expect(contador.textContent?.trim()).toBe('3');
      expect(contador.getAttribute('aria-label')).toBe('3 solicitudes por revisar');
    });

    it('no muestra ninguna cifra cuando el contador no tiene dato real', async () => {
      pendientes.set(null);
      await irA('/revisiones');
      expect(elementoRuta().querySelector('.gh-nav__contador')).toBeNull();
    });

    it('pide el contador una sola vez mientras el layout permanece montado', async () => {
      await irA('/revisiones');
      await irA('/incidencias');
      await irA('/gestion-estados');
      expect(refrescar).toHaveBeenCalledTimes(1);
    });

    it('el botón Menú controla aria-expanded y el sidebar plegable', async () => {
      await irA('/revisiones');
      const boton = elementoRuta().querySelector('.gh-menu') as HTMLButtonElement;
      expect(boton.getAttribute('aria-expanded')).toBe('false');
      boton.click();
      harness.fixture.detectChanges();
      expect(boton.getAttribute('aria-expanded')).toBe('true');
      expect(elementoRuta().querySelector('.gh-sidebar--abierto')).not.toBeNull();
    });

    it('Escape cierra el menú móvil y devuelve el foco al botón Menú', async () => {
      await irA('/revisiones');
      const boton = elementoRuta().querySelector('.gh-menu') as HTMLButtonElement;
      boton.click();
      harness.fixture.detectChanges();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      harness.fixture.detectChanges();
      expect(boton.getAttribute('aria-expanded')).toBe('false');
      expect(elementoRuta().querySelector('.gh-sidebar--abierto')).toBeNull();
      expect(document.activeElement).toBe(boton);
    });

    it('elegir una sección desde el menú móvil lo cierra', async () => {
      await irA('/revisiones');
      const boton = elementoRuta().querySelector('.gh-menu') as HTMLButtonElement;
      boton.click();
      harness.fixture.detectChanges();
      (Array.from(elementoRuta().querySelectorAll('.gh-nav__enlace'))
        .find(item => item.textContent?.trim() === 'Incidencias') as HTMLButtonElement).click();
      await harness.fixture.whenStable();
      harness.fixture.detectChanges();
      expect(elementoRuta().querySelector('.gh-sidebar--abierto')).toBeNull();
    });

    it('la cabecera no supera el ancho de la ventana (sin scroll horizontal)', async () => {
      await irA('/revisiones');
      const cabecera = elementoRuta().querySelector('app-gestor-header') as HTMLElement;
      expect(cabecera.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth + 1);
    });
  });

  describe('Home anidado bajo GestorLayout', () => {
    beforeEach(async () => {
      await crear(['GESTOR']);
    });

    it('/home muestra la cabecera del layout una sola vez y su contenido', async () => {
      await irA('/home');
      expect(cabeceras().length).toBe(1);
      expect(elementoRuta().querySelector('.inicio-prueba')).not.toBeNull();
      expect(seccionActiva()).toBe('Inicio');
    });

    it('volver a /home crea una instancia nueva que recarga sus datos; no hay recarga en navegación interna', async () => {
      await irA('/home');
      expect(instanciasInicio).toBe(1);
      await irA('/revisiones');
      await irA('/home');
      expect(instanciasInicio).toBe(2);
      await irA('/home');
      expect(instanciasInicio).toBe(2);
    });
  });

  describe('roles múltiples y administración', () => {
    it('ADMINISTRADOR conserva su interfaz sin cabecera de gestor', async () => {
      await crear(['ADMINISTRADOR']);
      await irA('/revisiones');
      expect(cabeceras().length).toBe(0);
      expect(elementoRuta().querySelector('.gh-sidebar')).toBeNull();
      expect(elementoRuta().querySelector('.pagina-prueba')).not.toBeNull();
    });

    it('ADMINISTRADOR en /home conserva el contenido sin sidebar de gestor', async () => {
      await crear(['ADMINISTRADOR']);
      await irA('/home');
      expect(cabeceras().length).toBe(0);
      expect(elementoRuta().querySelector('.inicio-prueba')).not.toBeNull();
    });

    it('GESTOR + ADMINISTRADOR tiene prioridad de administrador sin cabecera de gestor', async () => {
      await crear(['GESTOR', 'ADMINISTRADOR']);
      await irA('/incidencias');
      expect(cabeceras().length).toBe(0);
    });

    it('ESTUDIANTE + GESTOR muestra el sidebar con el selector de espacio de estudiante', async () => {
      await crear(['ESTUDIANTE', 'GESTOR']);
      await irA('/revisiones');
      expect(cabeceras().length).toBe(1);
      expect(elementoRuta().querySelector('.gh-sidebar')).not.toBeNull();
      expect(elementoRuta().querySelector('.gh-cambio')?.textContent).toContain('Mi práctica');
    });

    it('ESTUDIANTE + GESTOR: el cambio abre el espacio V3 del estudiante', async () => {
      await crear(['ESTUDIANTE', 'GESTOR']);
      await irA('/revisiones');
      const navegar = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      (elementoRuta().querySelector('.gh-cambio') as HTMLButtonElement).click();
      expect(navegar).toHaveBeenCalledWith(['/estudiante/inicio']);
    });

    it('un gestor sin rol de estudiante no muestra el cambio de espacio', async () => {
      await crear(['GESTOR']);
      await irA('/revisiones');
      expect(elementoRuta().querySelector('.gh-cambio')).toBeNull();
    });
  });

  /**
   * Regresión de altura: el router-outlet es un ancla vacía y no debe repartir el alto
   * disponible con la página enrutada. Las medidas son relativas al contenedor, no a
   * tamaños de pantalla fijos.
   */
  describe('geometría del contenedor', () => {
    const contenedor = (): HTMLElement => elementoRuta().querySelector('.gl-contenido') as HTMLElement;
    const salida = (): HTMLElement => contenedor().querySelector(':scope > router-outlet') as HTMLElement;
    const paginaEnrutada = (): HTMLElement =>
      contenedor().querySelector(':scope > router-outlet + *') as HTMLElement;

    /** Da al árbol de prueba un alto definido, como lo tiene el contenedor de Ionic en la app. */
    function fijarAltoDisponible(): void {
      harness.fixture.nativeElement.style.height = `${window.innerHeight}px`;
      harness.fixture.detectChanges();
    }

    describe('gestor sin administración', () => {
      beforeEach(async () => {
        await crear(['GESTOR']);
        fijarAltoDisponible();
        await irA('/revisiones');
      });

      it('el router-outlet no ocupa altura artificial', () => {
        expect(salida()).not.toBeNull();
        expect(salida().getBoundingClientRect().height).toBeLessThan(1);
      });

      it('la página enrutada ocupa el alto disponible del contenedor', () => {
        const alto = paginaEnrutada().getBoundingClientRect().height;
        const disponible = contenedor().getBoundingClientRect().height;
        expect(Math.abs(alto - disponible)).toBeLessThan(1);
      });

      it('el contenido empieza justo debajo de la barra superior, sin hueco superior', () => {
        const desplazamiento = paginaEnrutada().getBoundingClientRect().top
          - contenedor().getBoundingClientRect().top;
        expect(Math.abs(desplazamiento)).toBeLessThan(1);
      });

      it('mantiene el scroll interno de la página sin desbordar el contenedor', async () => {
        await irA('/alta');
        fijarAltoDisponible();
        const pagina = paginaEnrutada();
        expect(pagina.getBoundingClientRect().height)
          .toBeLessThanOrEqual(contenedor().getBoundingClientRect().height + 1);
        const ionContent = pagina.querySelector('ion-content') as HTMLElement;
        const desplazable = ionContent.shadowRoot?.querySelector('.inner-scroll') as HTMLElement | null;
        expect(desplazable).not.toBeNull();
        expect(desplazable!.scrollHeight).toBeGreaterThan(desplazable!.clientHeight);
        desplazable!.scrollTop = 120;
        expect(desplazable!.scrollTop).toBeGreaterThan(0);
      });
    });

    describe('administrador', () => {
      beforeEach(async () => {
        await crear(['ADMINISTRADOR']);
        fijarAltoDisponible();
        await irA('/revisiones');
      });

      it('conserva el contenido visible con el alto del contenedor', () => {
        expect(salida().getBoundingClientRect().height).toBeLessThan(1);
        expect(paginaEnrutada().querySelector('.pagina-prueba')).not.toBeNull();
        const alto = paginaEnrutada().getBoundingClientRect().height;
        expect(alto).toBeGreaterThan(0);
        expect(Math.abs(alto - contenedor().getBoundingClientRect().height)).toBeLessThan(1);
      });
    });
  });
});
