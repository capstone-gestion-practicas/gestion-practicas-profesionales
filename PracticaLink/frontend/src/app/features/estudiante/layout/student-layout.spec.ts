import { Component, WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ModalController } from '@ionic/angular';
import { provideIonicAngular } from '@ionic/angular';
import { of } from 'rxjs';
import { Notificaciones } from '../../notificaciones/pages/notificaciones/notificaciones';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { PracticaService } from '../../../core/services/practica.service';
import { AuthStore } from '../../../core/store/auth.store';
import { NotificacionService } from '../../notificaciones/services/notificacion.service';
import { StudentLayout } from './student-layout';
import { StudentHome } from '../home/student-home';
import { PracticaForm } from '../../../pages/practica-form/practica-form';
import { CompletarPerfilModal } from '../components/completar-perfil-modal/completar-perfil-modal';

@Component({ standalone: true, template: '<p>Contenido de ruta de prueba</p>' })
class LayoutTestPage {}

const testRoutes: Routes = [
  {
    path: 'estudiante',
    component: StudentLayout,
    children: [
      { path: 'inicio', component: LayoutTestPage },
      { path: 'mi-practica', component: LayoutTestPage },
      { path: 'notificaciones', component: LayoutTestPage },
      { path: 'perfil', component: LayoutTestPage }
    ]
  },
  { path: 'home', component: LayoutTestPage },
  { path: 'login', component: LayoutTestPage }
];

describe('StudentLayout', () => {
  let authStore: AuthStore;
  let noLeidas: WritableSignal<number>;
  let practicaService: jasmine.SpyObj<PracticaService>;
  let modalController: jasmine.SpyObj<ModalController>;

  const contexto = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: {
      id_usuario: 27,
      nombre: 'Estudiante',
      apellido: 'Ejemplo',
      correo: 'estudiante@example.test'
    },
    roles,
    perfil: null,
    practica_actual: null
  });

  beforeEach(async () => {
    noLeidas = signal(0);
    practicaService = jasmine.createSpyObj<PracticaService>(
      'PracticaService',
      ['obtenerMiPractica', 'obtenerHistorialEstados']
    );
    modalController = jasmine.createSpyObj<ModalController>('ModalController', ['create']);
    modalController.create.and.returnValue(Promise.resolve({
      present: jasmine.createSpy('present').and.returnValue(Promise.resolve())
    } as unknown as HTMLIonModalElement));

    await TestBed.configureTestingModule({
      imports: [StudentLayout, StudentHome],
      providers: [
        AuthStore,
        { provide: NotificacionService, useValue: { noLeidas, estadoRegistroPush: signal('inactivo'), listar: () => of({ notificaciones: [], no_leidas: 0 }) } },
        provideIonicAngular(),
        { provide: PracticaService, useValue: practicaService },
        { provide: ModalController, useValue: modalController },
        // Rutas de prueba locales; no se modifica app.routes.ts.
        provideRouter(testRoutes)
      ]
    }).compileComponents();

    // La configuración del router se añade como provider independiente para mantener
    // los destinos futuros fuera de las rutas de producción.
    authStore = TestBed.inject(AuthStore);
  });

  async function crearHarness(roles: string[] | null = ['ESTUDIANTE']): Promise<RouterTestingHarness> {
    if (roles) authStore.setContexto(contexto(roles));
    return RouterTestingHarness.create('/estudiante/inicio');
  }

  function root(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  it('renders the brand, three destinations and a child router outlet', async () => {
    const harness = await crearHarness();
    const element = root(harness);

    expect(element.querySelector('app-brand-mark .brand-mark__nombre')?.textContent).toContain('PracticaLink');
    expect(element.querySelector('app-brand-mark ion-icon')?.getAttribute('name')).toBe('school-outline');
    expect(element.querySelector('nav[aria-label="Navegación del estudiante"]')).not.toBeNull();
    expect(Array.from(element.querySelectorAll('.student-layout__nav-label'))
      .map(item => item.textContent?.trim()))
      .toEqual(['Inicio', 'Mi práctica', 'Notificaciones']);
    expect(element.querySelector('router-outlet')).not.toBeNull();
    expect(element.textContent).toContain('Contenido de ruta de prueba');
  });

  it('marks only the current route as active and follows the prepared child destinations', async () => {
    const harness = await crearHarness();
    let element = root(harness);
    const navItems = () => Array.from(element.querySelectorAll('.student-layout__nav-item'));
    expect(navItems()[0].classList).toContain('student-layout__nav-item--active');
    expect(navItems()[0].getAttribute('aria-current')).toBe('page');

    await harness.navigateByUrl('/estudiante/mi-practica', StudentLayout);
    harness.fixture.detectChanges();
    element = root(harness);
    expect(navItems()[1].classList).toContain('student-layout__nav-item--active');
    expect(navItems()[1].getAttribute('aria-current')).toBe('page');
    expect(navItems()[0].classList).not.toContain('student-layout__nav-item--active');

    await harness.navigateByUrl('/estudiante/notificaciones', StudentLayout);
    harness.fixture.detectChanges();
    element = root(harness);
    expect(navItems()[2].classList).toContain('student-layout__nav-item--active');
    expect(navItems()[2].getAttribute('aria-current')).toBe('page');
  });

  it('shows the live unread count and accessible notification name', async () => {
    const harness = await crearHarness();
    noLeidas.set(4);
    harness.fixture.detectChanges();
    const element = root(harness);

    expect(element.querySelector('.student-layout__topbar-count')?.textContent?.trim()).toBe('4');
    expect(element.querySelector('.student-layout__notification-link')
      ?.getAttribute('aria-label')).toBe('Notificaciones, 4 sin leer');
    expect(element.querySelector('.student-layout__nav-count')?.textContent).toContain('4');
  });

  it('keeps icons decorative and exposes names for navigation, notifications and avatar', async () => {
    const harness = await crearHarness();
    const element = root(harness);

    expect(Array.from(element.querySelectorAll('ion-icon')).every(icon =>
      icon.getAttribute('aria-hidden') === 'true'
    )).toBeTrue();
    expect(element.querySelector('nav')?.getAttribute('aria-label')).toBe('Navegación del estudiante');
    expect(element.querySelector('.student-layout__notification-link')
      ?.getAttribute('aria-label')).toBe('Notificaciones');
    expect(element.querySelector('.student-layout__avatar')?.getAttribute('aria-label'))
      .toBe('Avatar de Estudiante Ejemplo');
  });

  it('does not show a management switch to an exclusive student', async () => {
    const harness = await crearHarness(['ESTUDIANTE']);

    expect(root(harness).querySelector('.student-layout__workspace-switch')).toBeNull();
  });

  it('routes a student with a management role to the existing management home', async () => {
    const harness = await crearHarness(['ESTUDIANTE', 'GESTOR']);
    const button = root(harness).querySelector('.student-layout__workspace-switch') as HTMLButtonElement;

    expect(button.textContent?.trim()).toBe('Gestión');
    button.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/home');
  });

  it('supports the administrator role in the same workspace switch', async () => {
    const harness = await crearHarness(['ESTUDIANTE', 'ADMINISTRADOR']);

    expect(root(harness).querySelector('.student-layout__workspace-switch')).not.toBeNull();
  });

  it('renders safely without context and does not offer a role switch', async () => {
    const harness = await crearHarness(null);
    const element = root(harness);

    expect(element.querySelector('.student-layout__account-name')?.textContent?.trim()).toBe('Cuenta');
    expect(element.querySelector('.student-layout__avatar')?.textContent?.trim()).toBe('?');
    expect(element.querySelector('.student-layout__workspace-switch')).toBeNull();
  });

  it('clears the current session and navigates to login on logout', async () => {
    const harness = await crearHarness(['ESTUDIANTE']);
    sessionStorage.setItem('access_token', 'synthetic-test-token');
    const logout = root(harness).querySelector('.student-layout__logout--topbar') as HTMLButtonElement;

    logout.click();
    await harness.fixture.whenStable();

    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(authStore.contexto()).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it('does not request practice details or history', async () => {
    const harness = await crearHarness();
    expect(root(harness).querySelector('app-student-layout')).not.toBeNull();

    expect(practicaService.obtenerMiPractica).not.toHaveBeenCalled();
    expect(practicaService.obtenerHistorialEstados).not.toHaveBeenCalled();
  });

  it('conecta los eventos del Home estudiante a los formularios existentes', async () => {
    const layout = TestBed.createComponent(StudentLayout).componentInstance;
    const homeFixture = TestBed.createComponent(StudentHome);
    const abrirRegistroPractica = spyOn(layout, 'abrirRegistroPractica');
    const abrirCompletarPerfil = spyOn(layout, 'abrirCompletarPerfil');
    layout.vincularAcciones(homeFixture.componentInstance);

    homeFixture.componentInstance.solicitarRegistroPractica.emit();
    await Promise.resolve();
    expect(abrirRegistroPractica).toHaveBeenCalled();

    homeFixture.componentInstance.solicitarCompletarPerfil.emit();
    await Promise.resolve();
    expect(abrirCompletarPerfil).toHaveBeenCalled();
  });

  it('carga los formularios solo cuando se solicitan', async () => {
    const layout = TestBed.createComponent(StudentLayout).componentInstance;

    await layout.abrirRegistroPractica();
    expect(modalController.create).toHaveBeenCalledWith(jasmine.objectContaining({ component: PracticaForm }));

    await layout.abrirCompletarPerfil();
    expect(modalController.create).toHaveBeenCalledWith(jasmine.objectContaining({ component: CompletarPerfilModal }));
  });

  afterEach(() => sessionStorage.clear());
  describe('desplazamiento del área principal (contenedor tipo ion-page)', () => {
    /** Emula el ion-page de Ionic: altura fija y overflow oculto; el layout no debe depender del documento. */
    async function crearEnContenedor(alto = 400): Promise<{ harness: RouterTestingHarness; main: HTMLElement; layout: HTMLElement }> {
      const harness = await crearHarness();
      const host = root(harness);
      host.style.cssText = `position:absolute;top:0;left:0;right:0;height:${alto}px;overflow:hidden;display:block`;
      harness.fixture.detectChanges();
      await harness.fixture.whenStable();
      const main = host.querySelector('.student-layout__main') as HTMLElement;
      const layout = host.querySelector('.student-layout') as HTMLElement;
      return { harness, main, layout };
    }

    it('el layout ocupa exactamente la altura del contenedor', async () => {
      const { layout } = await crearEnContenedor(400);
      expect(layout.getBoundingClientRect().height).toBeCloseTo(400, 0);
    });

    it('el área principal desplaza su contenido cuando supera la altura disponible', async () => {
      const { harness, main } = await crearEnContenedor(400);
      const alto = document.createElement('div');
      alto.style.height = '1200px';
      alto.textContent = 'Contenido largo';
      main.appendChild(alto);
      harness.fixture.detectChanges();

      expect(getComputedStyle(main).overflowY).toBe('auto');
      expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
      main.scrollTop = 300;
      expect(main.scrollTop).toBeGreaterThan(0);
    });

    it('un hijo con altura porcentual (como ion-content) se resuelve contra el área principal', async () => {
      const { harness, main } = await crearEnContenedor(400);
      const hijo = document.createElement('div');
      hijo.style.height = '100%';
      main.appendChild(hijo);
      harness.fixture.detectChanges();

      expect(hijo.getBoundingClientRect().height).toBeGreaterThan(200);
    });
  });

  describe('Notificaciones dentro del layout', () => {
    it('muestra el estado vacío con altura visible dentro del área principal', async () => {
      TestBed.inject(Router).resetConfig([
        { path: 'estudiante', component: StudentLayout, children: [{ path: 'notificaciones', component: Notificaciones }] }
      ]);
      const harness = await RouterTestingHarness.create('/estudiante/notificaciones');
      const host = root(harness);
      host.style.cssText = 'position:absolute;top:0;left:0;right:0;height:400px;overflow:hidden;display:block';
      harness.fixture.detectChanges();
      await harness.fixture.whenStable();
      harness.fixture.detectChanges();

      const contenido = host.querySelector('ion-content') as HTMLElement | null;
      expect(contenido).not.toBeNull();
      expect(contenido!.getBoundingClientRect().height).toBeGreaterThan(200);
      expect(host.textContent).toContain('No tienes notificaciones todavía.');
    });
  });

  describe('nombre del estudiante', () => {
    it('muestra nombre y apellido reales desde AuthStore', async () => {
      const harness = await crearHarness(['ESTUDIANTE']);
      expect(root(harness).querySelector('.student-layout__account-name')?.textContent?.trim())
        .toBe('Estudiante Ejemplo');
    });

    it('usuario sin apellido muestra solo el nombre, sin espacios sobrantes', async () => {
      const harness = await crearHarness(null);
      authStore.setContexto({ ...contexto(['ESTUDIANTE']), usuario: { ...contexto(['ESTUDIANTE']).usuario, apellido: '' } });
      harness.fixture.detectChanges();
      expect(root(harness).querySelector('.student-layout__account-name')?.textContent?.trim()).toBe('Estudiante');
    });

    it('nombre largo se conserva completo en el DOM y el avatar lo anuncia', async () => {
      const largo = 'Maximiliano Alejandro Fernández Ramírez de la Cruz';
      const harness = await crearHarness(null);
      authStore.setContexto({ ...contexto(['ESTUDIANTE']), usuario: { id_usuario: 27, nombre: 'Maximiliano Alejandro', apellido: 'Fernández Ramírez de la Cruz', correo: 'a@example.test' } });
      harness.fixture.detectChanges();
      const element = root(harness);
      expect(element.querySelector('.student-layout__account-name')?.textContent?.trim()).toBe(largo);
      expect(element.querySelector('.student-layout__avatar')?.getAttribute('aria-label'))
        .toBe('Avatar de ' + largo);
    });

    it('el nombre de cuenta admite dos líneas y no se corta en una sola', async () => {
      const harness = await crearHarness(null);
      authStore.setContexto({ ...contexto(['ESTUDIANTE']), usuario: { id_usuario: 27, nombre: 'Maximiliano Alejandro', apellido: 'Fernández Ramírez de la Cruz', correo: 'a@example.test' } });
      harness.fixture.detectChanges();
      const nombre = root(harness).querySelector('.student-layout__account-name') as HTMLElement;
      const estilo = getComputedStyle(nombre);
      expect(estilo.webkitLineClamp || estilo.getPropertyValue('-webkit-line-clamp')).toBe('2');
    });
  });

  it('el avatar del estudiante es un círculo (ancho igual al alto) y no se deforma', async () => {
    const harness = await crearHarness(['ESTUDIANTE']);
    const avatar = root(harness).querySelector('.student-layout__avatar') as HTMLElement;
    const caja = avatar.getBoundingClientRect();
    expect(caja.width).toBeGreaterThan(0);
    expect(Math.abs(caja.width - caja.height)).toBeLessThanOrEqual(1);
  });

  describe('menú de cuenta', () => {
    beforeEach(() => {
      // Aislamiento: un overlay dejado por otro spec robaría el foco y cerraría el menú.
      document.querySelectorAll('ion-modal, ion-overlay').forEach(overlay => overlay.remove());
    });

    async function abrir(roles: string[] = ['ESTUDIANTE']) {
      const harness = await crearHarness(roles);
      const element = root(harness);
      const disparador = element.querySelector('.student-account__disparador') as HTMLButtonElement;
      disparador.click();
      harness.fixture.detectChanges();
      await harness.fixture.whenStable();
      harness.fixture.detectChanges();
      return { harness, element, disparador };
    }

    it('abre con aria-expanded y aria-controls apuntando al panel', async () => {
      const { element, disparador } = await abrir();
      expect(disparador.getAttribute('aria-expanded')).toBe('true');
      const panel = element.querySelector('#student-account-menu');
      expect(panel).not.toBeNull();
      expect(disparador.getAttribute('aria-controls')).toBe('student-account-menu');
    });

    it('cerrado: aria-expanded false, sin aria-controls y sin panel en el DOM', async () => {
      const harness = await crearHarness(['ESTUDIANTE']);
      const disparador = root(harness).querySelector('.student-account__disparador') as HTMLButtonElement;
      expect(disparador.getAttribute('aria-expanded')).toBe('false');
      expect(disparador.hasAttribute('aria-controls')).toBeFalse();
      expect(root(harness).querySelector('#student-account-menu')).toBeNull();
    });

    it('muestra el nombre completo del estudiante en el panel', async () => {
      const { element } = await abrir();
      expect(element.querySelector('.student-account__nombre')?.textContent?.trim()).toBe('Estudiante Ejemplo');
    });

    it('«Mi perfil» navega a /estudiante/perfil y cierra el menú', async () => {
      const { harness, element } = await abrir();
      const perfil = Array.from(element.querySelectorAll('.student-account__item') as NodeListOf<HTMLButtonElement>)
        .find(boton => boton.textContent?.includes('Mi perfil'));
      expect(perfil?.disabled).toBeFalse();
      perfil?.click();
      await harness.fixture.whenStable();
      harness.fixture.detectChanges();
      expect(TestBed.inject(Router).url).toBe('/estudiante/perfil');
      expect(element.querySelector('#student-account-menu')).toBeNull();
    });
    it('mueve el foco a la primera acción al abrir', async () => {
      const { element } = await abrir();
      const cerrar = Array.from(element.querySelectorAll('.student-account__item') as NodeListOf<HTMLButtonElement>)
        .find(boton => boton.textContent?.includes('Cerrar sesión'));
      expect(document.activeElement).toBe(cerrar ?? null);
    });

    it('Escape cierra el menú y devuelve el foco al avatar', async () => {
      const { harness, element, disparador } = await abrir();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      harness.fixture.detectChanges();
      expect(element.querySelector('#student-account-menu')).toBeNull();
      expect(disparador.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(disparador);
    });

    it('un clic fuera del menú lo cierra sin robar el foco', async () => {
      const { harness, element } = await abrir();
      document.body.click();
      harness.fixture.detectChanges();
      expect(element.querySelector('#student-account-menu')).toBeNull();
    });

    it('cerrar sesión desde el menú limpia la sesión, cierra el panel y navega a login', async () => {
      const { harness, element } = await abrir();
      sessionStorage.setItem('access_token', 'synthetic');
      const cerrar = Array.from(element.querySelectorAll('.student-account__item') as NodeListOf<HTMLButtonElement>)
        .find(boton => boton.textContent?.includes('Cerrar sesión'));
      cerrar?.click();
      await harness.fixture.whenStable();
      expect(element.querySelector('#student-account-menu')).toBeNull();
      expect(sessionStorage.getItem('access_token')).toBeNull();
      expect(TestBed.inject(Router).url).toBe('/login');
    });

    it('con varios roles conserva el selector de espacio junto al menú', async () => {
      const { element } = await abrir(['ESTUDIANTE', 'GESTOR']);
      expect(element.querySelector('.student-layout__workspace-switch')).not.toBeNull();
      expect(element.querySelector('.student-account__disparador')).not.toBeNull();
    });
  });

  it('la campana de la topbar no tiene padding y su icono queda centrado en el botón', async () => {
    const harness = await crearHarness(['ESTUDIANTE']);
    const campana = root(harness).querySelector('.student-layout__notification-link') as HTMLElement;
    const icono = campana.querySelector('ion-icon') as HTMLElement;
    expect(getComputedStyle(campana).paddingLeft).toBe('0px');
    const caja = campana.getBoundingClientRect();
    // 44 px en escritorio y 40 px en móvil: el botón debe ser cuadrado en ambos casos.
    expect([40, 44]).toContain(Math.round(caja.width));
    expect(Math.abs(caja.width - caja.height)).toBeLessThanOrEqual(1);
    const iconoCaja = icono.getBoundingClientRect();
    expect(Math.abs((iconoCaja.left + iconoCaja.width / 2) - (caja.left + caja.width / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs((iconoCaja.top + iconoCaja.height / 2) - (caja.top + caja.height / 2))).toBeLessThanOrEqual(2);
  });
});
