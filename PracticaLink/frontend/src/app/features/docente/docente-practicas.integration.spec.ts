import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideIonicAngular } from '@ionic/angular';
import { Subject, of, throwError } from 'rxjs';

import { routes } from '../../app.routes';
import { AuthService } from '../../core/services/auth.service';
import { SesionService } from '../../core/session/sesion.service';
import { AuthStore } from '../../core/store/auth.store';
import { NotificacionService } from '../notificaciones/services/notificacion.service';
import { DocentePracticas } from './docente-practicas';
import { DocenteService, PracticaDocente } from './docente.service';

describe('Visibilidad de /docente/practicas dentro del layout real', () => {
  let api: jasmine.SpyObj<DocenteService>;
  let host: HTMLElement;
  let harness: RouterTestingHarness;
  let tokenAnterior: string | null;
  const practica: PracticaDocente = {
    id_practica: 15,
    estado: 'EN_CURSO',
    estudiante: 'Estudiante sintético',
    centro_practica: 'Centro sintético',
    fecha_inicio: null,
    fecha_termino: null,
    cargo_funcion: null,
    descripcion: null,
    informe_estado: null,
    informe_version: null,
    evaluacion_resultado: null
  };

  beforeEach(async () => {
    tokenAnterior = sessionStorage.getItem('access_token');
    sessionStorage.setItem('access_token', 'token-sintetico');
    api = jasmine.createSpyObj<DocenteService>('DocenteService', ['listar', 'obtener']);
    api.listar.and.returnValue(of([practica]));
    await TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideIonicAngular(),
        { provide: DocenteService, useValue: api },
        { provide: AuthService, useValue: jasmine.createSpyObj('AuthService', ['obtenerContexto']) },
        { provide: SesionService, useValue: jasmine.createSpyObj('SesionService', ['cerrar']) },
        { provide: NotificacionService, useValue: { noLeidas: signal(0) } }
      ]
    }).compileComponents();
    TestBed.inject(AuthStore).setContexto({
      usuario: { id_usuario: 3, nombre: 'Docente', apellido: 'Sintético', correo: 'docente@example.test' },
      roles: ['DOCENTE'],
      perfil: null,
      practica_actual: null
    });
  });

  afterEach(() => {
    if (tokenAnterior === null) sessionStorage.removeItem('access_token');
    else sessionStorage.setItem('access_token', tokenAnterior);
  });

  async function montar(): Promise<void> {
    harness = await RouterTestingHarness.create('/docente/practicas');
    host = harness.fixture.nativeElement as HTMLElement;
    // Altura acotada y overflow como el ion-page que contiene el layout en producción.
    host.style.cssText = 'position:absolute;inset:0;height:600px;display:block;overflow:hidden';
    harness.detectChanges();
    await harness.fixture.whenStable();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    harness.detectChanges();
  }

  function visible(selector: string): HTMLElement {
    const elemento = host.querySelector<HTMLElement>(selector)!;
    expect(elemento).withContext(selector).not.toBeNull();
    const caja = elemento.getBoundingClientRect();
    const pagina = host.querySelector<HTMLElement>('.teacher-page')!.getBoundingClientRect();
    const main = host.querySelector<HTMLElement>('#docente-main-content')!.getBoundingClientRect();
    expect(pagina.height).withContext('La página no debe colapsar aunque tenga texto en el DOM').toBeGreaterThan(100);
    expect(caja.width).toBeGreaterThan(0);
    expect(caja.height).toBeGreaterThan(0);
    expect(caja.top).toBeGreaterThanOrEqual(Math.max(main.top, pagina.top));
    expect(caja.bottom).toBeLessThanOrEqual(Math.min(main.bottom, pagina.bottom));
    expect(getComputedStyle(elemento).visibility).toBe('visible');
    return elemento;
  }

  function encabezadoVisible(): void {
    const hijo = host.querySelector('app-docente-practicas');
    expect(hijo).not.toBeNull();
    expect(harness.fixture.debugElement.queryAll(By.directive(DocentePracticas)).length).toBe(1);
    expect(visible('h1').textContent).toContain('Mis prácticas asignadas');
    expect(api.listar).toHaveBeenCalledTimes(1);
    expect(api.obtener).not.toHaveBeenCalled();
  }

  it('monta la ruta hija y muestra el encabezado y las prácticas asignadas', async () => {
    await montar();
    encabezadoVisible();
    expect(visible('.practice-card').textContent).toContain(practica.estudiante);
  });

  it('muestra el encabezado y el estado vacío tras recibir cero asignaciones', async () => {
    api.listar.and.returnValue(of([]));
    await montar();
    encabezadoVisible();
    expect(visible('.empty-state').textContent).toContain('Todavía no tienes prácticas asignadas');
  });

  it('permite llegar a la última práctica desplazando el área principal sin mover la topbar', async () => {
    api.listar.and.returnValue(of(Array.from({ length: 12 }, (_, indice) => ({
      ...practica,
      id_practica: indice + 1,
      estudiante: `Estudiante sintético ${indice + 1}`
    }))));
    await montar();
    encabezadoVisible();
    const main = host.querySelector<HTMLElement>('#docente-main-content')!;
    const topbar = host.querySelector<HTMLElement>('.student-layout__topbar')!;
    const posicionTopbar = topbar.getBoundingClientRect().top;
    expect(getComputedStyle(main).overflowY).toBe('auto');
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
    main.scrollTop = main.scrollHeight;
    expect(main.scrollTop).toBeGreaterThan(0);
    expect(visible('.practice-card:last-child').textContent).toContain('Estudiante sintético 12');
    expect(topbar.getBoundingClientRect().top).toBe(posicionTopbar);
  });

  it('mantiene visibles el encabezado y la carga mientras espera la respuesta', async () => {
    const respuesta = new Subject<PracticaDocente[]>();
    api.listar.and.returnValue(respuesta);
    await montar();
    encabezadoVisible();
    expect(visible('.state').textContent).toContain('Cargando prácticas asignadas');
    expect(host.querySelector('.empty-state')).toBeNull();
    respuesta.next([]);
    respuesta.complete();
    harness.detectChanges();
    expect(visible('.empty-state').textContent).toContain('Todavía no tienes prácticas asignadas');
  });

  it('muestra el encabezado, el error y permite recuperar el listado', async () => {
    api.listar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await montar();
    encabezadoVisible();
    expect(visible('[role="alert"]').textContent).toContain('No fue posible cargar');
    expect(host.querySelector('.empty-state')).toBeNull();
    api.listar.and.returnValue(of([practica]));
    visible('.state ion-button').click();
    harness.detectChanges();
    expect(visible('.practice-card').textContent).toContain(practica.estudiante);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
