import { Component, NgZone, OnInit, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { IonApp, IonRouterOutlet, NavController, provideIonicAngular } from '@ionic/angular';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { AuthStore } from '../../../core/store/auth.store';
import { NotificacionService } from '../../notificaciones/services/notificacion.service';
import { SolicitudesPendientesService } from '../../../core/services/solicitudes-pendientes.service';
import { GestorLayout } from './gestor-layout';

/** Página genérica hija del layout: carga por HTTP y muestra su estado. */
@Component({
  selector: 'app-hijo-http-prueba',
  standalone: true,
  template: '<p class="estado-hijo">{{ cargando ? "Cargando" : "Listo" }}</p>'
})
class HijoHttpPrueba implements OnInit {
  private readonly http = inject(HttpClient);
  cargando = true;
  ngOnInit(): void {
    this.http.get('/api-hijo').subscribe({
      next: () => { this.cargando = false; },
      error: () => { this.cargando = false; }
    });
  }
}

@Component({ selector: 'app-inicio-carga', standalone: true, template: '<p>Inicio</p>' })
class InicioCarga {}

@Component({
  selector: 'app-anfitrion-carga',
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  template: '<ion-app><ion-router-outlet /></ion-app>'
})
class AnfitrionCarga {}

const rutas: Routes = [
  { path: 'home', component: InicioCarga },
  {
    path: '',
    component: GestorLayout,
    children: [
      { path: 'hijo', component: HijoHttpPrueba },
      { path: 'revisiones', loadComponent: () => import('../../../pages/revisiones/revisiones').then(m => m.Revisiones) },
      { path: 'gestion-estados', loadComponent: () => import('../../../pages/gestion-estados/gestion-estados').then(m => m.GestionEstados) },
      { path: 'seguimientos', loadComponent: () => import('../../../pages/seguimientos/seguimientos').then(m => m.Seguimientos) },
      { path: 'incidencias', loadComponent: () => import('../../../pages/incidencias/incidencias').then(m => m.Incidencias) }
    ]
  },
  { path: '**', redirectTo: 'home' }
];

const contexto = (roles: string[]): ContextoUsuarioResponse => ({
  usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Demo', correo: 'gestor@practicalink.cl' },
  roles,
  perfil: null,
  practica_actual: null
});

const practica = {
  id_practica: 7,
  id_estado: 2,
  estado: 'EN_CURSO',
  fecha_termino: null,
  es_final: false,
  estudiante: 'Ana Soto',
  rut_estudiante: '12.345.678-5',
  centro_practica: 'Centro demostrativo',
  id_gestor: null,
  fecha_registro: '2026-10-01'
};

describe('Carga de módulos del gestor bajo GestorLayout (integración, flush dentro de NgZone)', () => {
  let fixture: ComponentFixture<AnfitrionCarga>;
  let router: Router;
  let http: HttpTestingController;
  let zona: NgZone;

  const texto = (): string => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');

  /** Responde una petición pendiente dentro de la zona de Angular, como lo haría la aplicación. */
  function responder(url: string, cuerpo: any): void {
    const pendiente: TestRequest = http.expectOne(req => req.url.endsWith(url));
    zona.run(() => pendiente.flush(cuerpo));
  }

  async function montar(roles: string[], ruta: string): Promise<void> {
    TestBed.inject(AuthStore).setContexto(contexto(roles));
    await router.navigateByUrl('/home');
    await fixture.whenStable();
    await router.navigateByUrl(ruta);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AnfitrionCarga],
      providers: [
        provideIonicAngular(),
        provideRouter(rutas),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        AuthStore,
        { provide: NotificacionService, useValue: { noLeidas: signal(0) } },
        { provide: SolicitudesPendientesService, useValue: { total: signal<number | null>(null), refrescar: () => undefined } }
      ]
    });
    TestBed.inject(NavController);
    router = TestBed.inject(Router);
    http = TestBed.inject(HttpTestingController);
    zona = TestBed.inject(NgZone);
    fixture = TestBed.createComponent(AnfitrionCarga);
    fixture.autoDetectChanges();
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    fixture.destroy();
  });

  describe('gestor sin administración', () => {
    it('componente hijo genérico: refleja la respuesta HTTP sin interacción', async () => {
      await montar(['GESTOR'], '/hijo');
      responder('/api-hijo', {});
      await fixture.whenStable();
      expect(texto()).toContain('Listo');
      expect(texto()).not.toContain('Cargando');
    });

    it('Solicitudes (Revisiones): muestra las solicitudes sin interacción', async () => {
      await montar(['GESTOR'], '/revisiones');
      responder('/solicitudes', [{
        id_practica: 11, fecha_registro: '2026-10-01', estado: 'PENDIENTE',
        estudiante: 'Ana Soto', rut_estudiante: '12.345.678-5', centro_practica: 'Centro demostrativo'
      }]);
      await fixture.whenStable();
      expect(texto()).toContain('Ana Soto');
      expect(texto()).not.toContain('Cargando solicitudes');
    });

    it('Estados: sale del estado de carga y muestra la práctica', async () => {
      await montar(['GESTOR'], '/gestion-estados');
      responder('/practicas/gestion-estados', [practica]);
      responder('/practicas/estados', []);
      await fixture.whenStable();
      expect(texto()).toContain('Ana Soto');
      expect(texto()).not.toContain('Cargando');
    });

    it('Seguimientos: sale del estado de carga y muestra la práctica', async () => {
      await montar(['GESTOR'], '/seguimientos');
      responder('/practicas/gestion-estados', [practica]);
      await fixture.whenStable();
      expect(texto()).toContain('Ana Soto');
      expect(texto()).not.toContain('Cargando');
    });

    it('Incidencias: sale del estado de carga', async () => {
      await montar(['GESTOR'], '/incidencias');
      responder('/practicas/gestion-estados', [practica]);
      responder('/incidencias', []);
      await fixture.whenStable();
      expect(texto()).not.toContain('Cargando');
      expect(texto()).toContain('Incidencias pendientes');
    });
  });

  describe('administrador (módulos compartidos)', () => {
    it('Solicitudes: sigue mostrando los datos y no muestra cabecera de gestor', async () => {
      await montar(['ADMINISTRADOR'], '/revisiones');
      responder('/solicitudes', [{
        id_practica: 11, fecha_registro: '2026-10-01', estado: 'PENDIENTE',
        estudiante: 'Ana Soto', rut_estudiante: '12.345.678-5', centro_practica: 'Centro demostrativo'
      }]);
      await fixture.whenStable();
      expect(texto()).toContain('Ana Soto');
      expect(document.querySelectorAll('app-gestor-header').length).toBe(0);
    });

    it('Estados: sale del estado de carga como administrador', async () => {
      await montar(['ADMINISTRADOR'], '/gestion-estados');
      responder('/practicas/gestion-estados', [practica]);
      responder('/practicas/estados', []);
      await fixture.whenStable();
      // listarGestores se pide solo tras terminar la carga principal (solo administrador).
      responder('/practicas/gestores', []);
      await fixture.whenStable();
      expect(texto()).toContain('Ana Soto');
      expect(texto()).not.toContain('Cargando');
    });
  });
});
