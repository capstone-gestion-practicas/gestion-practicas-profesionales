import { Component, NgZone, signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { IonApp, IonRouterOutlet, NavController, provideIonicAngular } from '@ionic/angular';

import { SolicitudRevisionResumen } from '../../../core/models/revision.models';
import { AuthStore } from '../../../core/store/auth.store';
import { NotificacionService } from '../../notificaciones/services/notificacion.service';
import { SolicitudesPendientesService } from '../../../core/services/solicitudes-pendientes.service';
import { GestorLayout } from './gestor-layout';

@Component({
  selector: 'app-pagina-inicio-prueba',
  standalone: true,
  template: '<p>Inicio de prueba</p>'
})
class InicioPrueba {}

/** Anfitrión con la misma estructura que la app: ion-app > ion-router-outlet raíz. */
@Component({
  selector: 'app-anfitrion-prueba',
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  template: '<ion-app><ion-router-outlet /></ion-app>'
})
class AnfitrionPrueba {}

const cargarRevisiones = () =>
  import('../../../pages/revisiones/revisiones').then(m => m.Revisiones);

/** Revisiones anidada dentro de GestorLayout, como en la app actual. */
const rutasConLayout: Routes = [
  { path: 'home', component: InicioPrueba },
  {
    path: '',
    component: GestorLayout,
    children: [{ path: 'revisiones', loadComponent: cargarRevisiones }]
  },
  { path: '**', redirectTo: 'home' }
];

/** Revisiones montada directamente bajo el ion-router-outlet raíz, sin contenedor. */
const rutasSinLayout: Routes = [
  { path: 'home', component: InicioPrueba },
  { path: 'revisiones', loadComponent: cargarRevisiones },
  { path: '**', redirectTo: 'home' }
];

const solicitud = (): SolicitudRevisionResumen => ({
  id_practica: 11,
  fecha_registro: '2026-10-01',
  estado: 'PENDIENTE',
  estudiante: 'Ana Soto',
  rut_estudiante: '12.345.678-5',
  centro_practica: 'Centro demostrativo'
});

/**
 * Reproduce el síntoma: la respuesta HTTP llega, el estado cambia y la plantilla debe
 * actualizarse sin interacción del usuario y sin llamar a detectChanges desde el test.
 */
function describeCarga(nombre: string, rutas: Routes): void {
  describe(nombre, () => {
    let fixture: ComponentFixture<AnfitrionPrueba>;
    let router: Router;
    let http: HttpTestingController;

    const textoRevisiones = (): string =>
      (document.querySelector('app-revisiones')?.textContent ?? '').replace(/\s+/g, ' ');

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [AnfitrionPrueba],
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
      TestBed.inject(AuthStore).setContexto({
        usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Demo', correo: 'gestor@practicalink.cl' },
        roles: ['GESTOR'],
        perfil: null,
        practica_actual: null
      });
      fixture = TestBed.createComponent(AnfitrionPrueba);
      fixture.autoDetectChanges();
    });

    afterEach(() => {
      http.verify({ ignoreCancelled: true });
      fixture.destroy();
    });

    // Reproduce el defecto: con GestorLayout en OnPush, Revisiones no se refresca tras la respuesta HTTP.
    it('muestra las solicitudes al llegar la respuesta, sin interacción del usuario', async () => {
      await router.navigateByUrl('/home');
      await fixture.whenStable();
      await router.navigateByUrl('/revisiones');
      await fixture.whenStable();

      // La respuesta se entrega dentro de NgZone, como en la aplicación real.
      const pendiente = http.expectOne(req => req.url.endsWith('/solicitudes'));
      TestBed.inject(NgZone).run(() => pendiente.flush([solicitud()]));
      await fixture.whenStable();

      expect(textoRevisiones()).toContain('Ana Soto');
      expect(textoRevisiones()).not.toContain('Cargando solicitudes');
    });
  });
}

describe('Carga de Revisiones con ion-router-outlet (reproducción)', () => {
  describeCarga('dentro de GestorLayout (anidada)', rutasConLayout);
  describeCarga('directamente bajo ion-router-outlet (control)', rutasSinLayout);
});
