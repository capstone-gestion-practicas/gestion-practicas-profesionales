import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { CLAVE_ESPACIO_TRABAJO } from '../../../core/navigation/espacio-gestor';
import { AuthStore } from '../../../core/store/auth.store';
import {
  PESTANAS_ACOMPANAMIENTO,
  PESTANAS_PRACTICAS,
  PestanaGestor,
  PestanasGestor
} from './pestanas-gestor';

const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
  usuario: { id_usuario: 1, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.test' },
  roles, perfil: null, practica_actual: null
});

const etiquetas = (raiz: HTMLElement): string[] =>
  Array.from(raiz.querySelectorAll('.pg-pestana') as NodeListOf<HTMLButtonElement>)
    .map(boton => boton.textContent?.trim() ?? '');

const activa = (raiz: HTMLElement): string | null =>
  raiz.querySelector('.pg-pestana[aria-current="page"]')?.textContent?.trim() ?? null;

describe('PestanasGestor', () => {
  let fixture: ComponentFixture<PestanasGestor>;
  let router: jasmine.SpyObj<Router>;
  let authStore: AuthStore;

  function crear(roles: string[], pestanas: readonly PestanaGestor[], ruta: string, espacio: string | null = null): HTMLElement {
    if (espacio) sessionStorage.setItem(CLAVE_ESPACIO_TRABAJO, espacio);
    authStore.setContexto(contextoCon(roles));
    fixture = TestBed.createComponent(PestanasGestor);
    fixture.componentRef.setInput('pestanas', pestanas);
    fixture.componentRef.setInput('activa', ruta);
    fixture.componentRef.setInput('etiqueta', 'Secciones de prueba');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    sessionStorage.removeItem(CLAVE_ESPACIO_TRABAJO);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    await TestBed.configureTestingModule({
      imports: [PestanasGestor],
      providers: [AuthStore, { provide: Router, useValue: router }]
    }).compileComponents();
    authStore = TestBed.inject(AuthStore);
  });

  afterEach(() => {
    fixture?.destroy();
    sessionStorage.removeItem(CLAVE_ESPACIO_TRABAJO);
  });

  it('GESTOR ve Solicitudes y Mis prácticas, con la página actual marcada', () => {
    const raiz = crear(['GESTOR'], PESTANAS_PRACTICAS, '/revisiones');
    expect(etiquetas(raiz)).toEqual(['Solicitudes', 'Mis prácticas']);
    expect(activa(raiz)).toBe('Solicitudes');
    expect(raiz.querySelectorAll('[aria-current="page"]').length).toBe(1);
    expect(raiz.querySelector('nav')?.getAttribute('aria-label')).toBe('Secciones de prueba');
  });

  it('GESTOR ve Seguimientos e Incidencias en Acompañamiento', () => {
    const raiz = crear(['GESTOR'], PESTANAS_ACOMPANAMIENTO, '/incidencias');
    expect(etiquetas(raiz)).toEqual(['Seguimientos', 'Incidencias']);
    expect(activa(raiz)).toBe('Incidencias');
  });

  it('usa botones nativos accesibles por teclado', () => {
    const raiz = crear(['GESTOR'], PESTANAS_PRACTICAS, '/practicas');
    const botones = Array.from(raiz.querySelectorAll('.pg-pestana') as NodeListOf<HTMLButtonElement>);
    expect(botones.every(boton => boton.tagName === 'BUTTON' && boton.type === 'button' && boton.tabIndex === 0)).toBeTrue();
    expect(raiz.querySelector('nav ul li .pg-pestana')).not.toBeNull();
  });

  it('navega a la otra pestaña con el router y no navega al pulsar la activa', () => {
    const raiz = crear(['GESTOR'], PESTANAS_PRACTICAS, '/revisiones');
    const [solicitudes, practicas] = Array.from(raiz.querySelectorAll('.pg-pestana') as NodeListOf<HTMLButtonElement>);
    solicitudes.click();
    expect(router.navigate).not.toHaveBeenCalled();
    practicas.click();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/practicas']);
  });

  describe('roles y espacio de trabajo', () => {
    const casos: [string, string[], string | null, boolean][] = [
      ['GESTOR dedicado', ['GESTOR'], null, true],
      ['ESTUDIANTE + GESTOR', ['ESTUDIANTE', 'GESTOR'], null, true],
      ['ADMINISTRADOR', ['ADMINISTRADOR'], null, false],
      ['ADMINISTRADOR con espacio GESTOR guardado', ['ADMINISTRADOR'], 'GESTOR', false],
      ['GESTOR + ADMINISTRADOR sin espacio elegido', ['GESTOR', 'ADMINISTRADOR'], null, false],
      ['GESTOR + ADMINISTRADOR en espacio GESTOR', ['GESTOR', 'ADMINISTRADOR'], 'GESTOR', true],
      ['GESTOR + ADMINISTRADOR en espacio ADMINISTRADOR', ['GESTOR', 'ADMINISTRADOR'], 'ADMINISTRADOR', false],
      ['DOCENTE', ['DOCENTE'], null, false],
      ['ESTUDIANTE', ['ESTUDIANTE'], null, false]
    ];
    for (const [caso, roles, espacio, visible] of casos) {
      it(`${caso}: ${visible ? 'muestra' : 'no muestra'} las pestañas`, () => {
        for (const [pestanas, ruta] of [[PESTANAS_PRACTICAS, '/practicas'], [PESTANAS_ACOMPANAMIENTO, '/seguimientos']] as const) {
          const raiz = crear(roles, pestanas, ruta, espacio);
          expect(raiz.querySelector('nav') !== null).withContext(ruta).toBe(visible);
          fixture.destroy();
        }
      });
    }

    it('nunca ofrece Solicitudes a quien no tiene GESTOR', () => {
      const raiz = crear(['ADMINISTRADOR'], PESTANAS_PRACTICAS, '/practicas', 'GESTOR');
      expect(etiquetas(raiz)).not.toContain('Solicitudes');
    });

    it('filtra destinos por rol y oculta la navegación si queda un solo destino', () => {
      const conRestriccion: PestanaGestor[] = [
        { etiqueta: 'Uno', ruta: '/uno' },
        { etiqueta: 'Dos', ruta: '/dos', rolesRequeridos: ['DOCENTE'] }
      ];
      const raiz = crear(['GESTOR'], conRestriccion, '/uno');
      expect(raiz.querySelector('nav')).toBeNull();
      fixture.destroy();
      const ambas = crear(['GESTOR', 'DOCENTE'], conRestriccion, '/uno');
      expect(etiquetas(ambas)).toEqual(['Uno', 'Dos']);
    });
  });
});

@Component({
  selector: 'app-pagina-solicitudes',
  standalone: true,
  imports: [PestanasGestor],
  template: '<app-pestanas-gestor [pestanas]="pestanas" activa="/revisiones" etiqueta="Secciones de Prácticas" /><p class="pagina">solicitudes</p>'
})
class PaginaSolicitudes { readonly pestanas = PESTANAS_PRACTICAS; }

@Component({
  selector: 'app-pagina-practicas',
  standalone: true,
  imports: [PestanasGestor],
  template: '<app-pestanas-gestor [pestanas]="pestanas" activa="/practicas" etiqueta="Secciones de Prácticas" /><p class="pagina">practicas</p>'
})
class PaginaPracticas { readonly pestanas = PESTANAS_PRACTICAS; }

const rutas: Routes = [
  { path: 'revisiones', component: PaginaSolicitudes },
  { path: 'practicas', component: PaginaPracticas }
];

describe('PestanasGestor con el router (historial del navegador)', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  const raiz = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const esperar = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(rutas), provideLocationMocks(), AuthStore] });
    TestBed.inject(AuthStore).setContexto(contextoCon(['GESTOR']));
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
    router.setUpLocationChangeListener();
  });

  it('cambia de página por pestañas y conserva Atrás y Adelante', async () => {
    await harness.navigateByUrl('/revisiones?estado=OBSERVADA');
    harness.fixture.detectChanges();
    expect(activa(raiz())).toBe('Solicitudes');

    (Array.from(raiz().querySelectorAll('.pg-pestana') as NodeListOf<HTMLButtonElement>)
      .find(boton => boton.textContent?.trim() === 'Mis prácticas') as HTMLButtonElement).click();
    await esperar();
    expect(router.url).toBe('/practicas');
    expect(activa(raiz())).toBe('Mis prácticas');

    TestBed.inject(Location).back();
    await esperar();
    expect(router.url).toBe('/revisiones?estado=OBSERVADA');
    expect(activa(raiz())).toBe('Solicitudes');

    TestBed.inject(Location).forward();
    await esperar();
    expect(router.url).toBe('/practicas');
    expect(activa(raiz())).toBe('Mis prácticas');
  });
});
