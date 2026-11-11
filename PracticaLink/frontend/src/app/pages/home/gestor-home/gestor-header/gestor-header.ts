import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

import { AuthStore } from '../../../../core/store/auth.store';
import { SesionService } from '../../../../core/session/sesion.service';
import { SolicitudesPendientesService } from '../../../../core/services/solicitudes-pendientes.service';
import { NotificacionService } from '../../../../features/notificaciones/services/notificacion.service';
import { BrandMark } from '../../../../shared/components/brand-mark/brand-mark';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  documentTextOutline,
  folderOpenOutline,
  homeOutline,
  notificationsOutline,
  optionsOutline,
  paperPlaneOutline,
  pulseOutline,
  warningOutline
} from 'ionicons/icons';

/** Destino concreto del sidebar (o la campana) que corresponde a la URL actual. */
export type SeccionGestor =
  | 'inicio' | 'solicitudes' | 'practicas' | 'estados' | 'seguimientos' | 'incidencias' | 'avisos' | 'notificaciones';

/** Agrupación principal del sidebar del gestor. */
export type GrupoGestor = 'inicio' | 'practicas' | 'acompanamiento' | 'comunicaciones';

const GRUPO_DE_SECCION: Readonly<Record<SeccionGestor, GrupoGestor | null>> = {
  inicio: 'inicio',
  solicitudes: 'practicas',
  practicas: 'practicas',
  estados: 'practicas',
  seguimientos: 'acompanamiento',
  incidencias: 'acompanamiento',
  avisos: 'comunicaciones',
  notificaciones: null
};

/** true si la ruta es exactamente la base o una ruta hija suya (/base/...). */
function coincide(ruta: string, base: string): boolean {
  return ruta === base || ruta.startsWith(`${base}/`);
}

/** Sección del espacio de gestión para una URL; null si no pertenece a él. */
export function seccionGestorDeUrl(url: string): SeccionGestor | null {
  const ruta = url.split(/[?#]/)[0];
  if (ruta === '/home') return 'inicio';
  if (coincide(ruta, '/revisiones')) return 'solicitudes';
  if (coincide(ruta, '/practicas')) return 'practicas';
  if (coincide(ruta, '/gestion-estados')) return 'estados';
  if (coincide(ruta, '/seguimientos')) return 'seguimientos';
  if (coincide(ruta, '/incidencias')) return 'incidencias';
  if (coincide(ruta, '/envio-notificaciones')) return 'avisos';
  if (coincide(ruta, '/notificaciones')) return 'notificaciones';
  return null;
}

/**
 * Shell del espacio de gestión: sidebar de navegación y barra superior. Envuelve el
 * contenido proyectado (GestorLayout). Sin lógica de negocio: el contador sale de
 * SolicitudesPendientesService y las notificaciones de NotificacionService.
 */
@Component({
  selector: 'app-gestor-header',
  standalone: true,
  imports: [BrandMark, RouterLink, IonIcon],
  templateUrl: './gestor-header.html',
  styleUrl: './gestor-header.scss',
  changeDetection: ChangeDetectionStrategy.Default
})
export class GestorHeader implements OnInit {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly sesion = inject(SesionService);
  private readonly notificacionService = inject(NotificacionService);
  private readonly pendientes = inject(SolicitudesPendientesService);

  protected readonly notificacionesNoLeidas = this.notificacionService.noLeidas;
  /** null hasta tener dato real: no se muestra ninguna cifra inventada. */
  protected readonly solicitudesPorRevisar = this.pendientes.total;
  protected readonly nombre = computed(() => this.authStore.contexto()?.usuario.nombre ?? '');
  protected readonly inicial = computed(() => this.nombre().charAt(0).toUpperCase());
  /** Usuarios con doble rol (estudiante y gestión) pueden abrir el espacio V3 del estudiante. */
  protected readonly tieneEspacioEstudiante = computed(() => {
    const roles = this.authStore.contexto()?.roles ?? [];
    return roles.includes('ESTUDIANTE') && (roles.includes('GESTOR') || roles.includes('ADMINISTRADOR'));
  });
  protected readonly menuCuentaAbierto = signal(false);
  /** Menú lateral plegable en pantallas de 900 px o menos. */
  protected readonly menuMovilAbierto = signal(false);

  private readonly urlActual = toSignal(
    this.router.events.pipe(
      filter((evento): evento is NavigationEnd => evento instanceof NavigationEnd),
      map(evento => evento.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  /** Destino que corresponde a la URL actual, incluidas sus rutas hijas; null si no pertenece al espacio. */
  protected readonly seccionActiva = computed<SeccionGestor | null>(() => seccionGestorDeUrl(this.urlActual()));

  /** Agrupación principal activa (Inicio, Prácticas, Acompañamiento o Comunicaciones). */
  protected readonly grupoActivo = computed<GrupoGestor | null>(() => {
    const seccion = this.seccionActiva();
    return seccion ? GRUPO_DE_SECCION[seccion] : null;
  });

  private readonly cuenta = viewChild<ElementRef<HTMLElement>>('cuenta');
  private readonly botonMenuMovil = viewChild<ElementRef<HTMLButtonElement>>('botonMenuMovil');

  constructor() {
    addIcons({
      homeOutline, documentTextOutline, folderOpenOutline, optionsOutline, pulseOutline, warningOutline,
      paperPlaneOutline, notificationsOutline
    });
  }

  ngOnInit(): void {
    this.pendientes.refrescar();
  }

  protected irA(ruta: string): void {
    this.cerrarMenuMovil();
    void this.router.navigate([ruta]);
  }

  protected abrirNotificaciones(): void {
    void this.router.navigate(['/notificaciones']);
  }

  protected irAEspacioEstudiante(): void {
    void this.router.navigate(['/estudiante/inicio']);
  }

  protected alternarMenuCuenta(): void {
    this.menuCuentaAbierto.update(abierto => !abierto);
  }

  protected alternarMenuMovil(): void {
    this.menuMovilAbierto.update(abierto => !abierto);
  }

  protected cerrarMenuMovil(): void {
    if (this.menuMovilAbierto()) {
      this.menuMovilAbierto.set(false);
      this.botonMenuMovil()?.nativeElement.focus();
    }
  }

  protected cerrarSesion(): void {
    this.menuCuentaAbierto.set(false);
    this.menuMovilAbierto.set(false);
    this.sesion.cerrar();
  }

  @HostListener('document:click', ['$event'])
  protected alHacerClicFuera(evento: Event): void {
    const cuenta = this.cuenta()?.nativeElement;
    if (this.menuCuentaAbierto() && cuenta && !cuenta.contains(evento.target as Node)) {
      this.menuCuentaAbierto.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected alPresionarEscape(): void {
    if (this.menuCuentaAbierto()) {
      this.menuCuentaAbierto.set(false);
      this.cuenta()?.nativeElement.querySelector('button')?.focus();
      return;
    }
    this.cerrarMenuMovil();
  }
}
