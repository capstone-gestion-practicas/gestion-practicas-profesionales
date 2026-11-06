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

export type SeccionGestor = 'inicio' | 'solicitudes' | 'estados' | 'seguimientos' | 'incidencias' | 'avisos';

/**
 * Shell del espacio de gestión: sidebar de navegación y barra superior. Envuelve el
 * contenido proyectado (GestorLayout). Sin lógica de negocio: el contador sale de
 * SolicitudesPendientesService y las notificaciones de NotificacionService.
 */
@Component({
  selector: 'app-gestor-header',
  standalone: true,
  imports: [BrandMark, RouterLink],
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

  /** Sección que corresponde a la URL actual; null si no pertenece al espacio de gestión. */
  protected readonly seccionActiva = computed<SeccionGestor | null>(() => {
    const ruta = this.urlActual().split('?')[0];
    if (ruta === '/home') return 'inicio';
    if (ruta.startsWith('/revisiones')) return 'solicitudes';
    if (ruta.startsWith('/gestion-estados')) return 'estados';
    if (ruta.startsWith('/seguimientos')) return 'seguimientos';
    if (ruta.startsWith('/incidencias')) return 'incidencias';
    if (ruta.startsWith('/envio-notificaciones')) return 'avisos';
    return null;
  });

  private readonly cuenta = viewChild<ElementRef<HTMLElement>>('cuenta');
  private readonly botonMenuMovil = viewChild<ElementRef<HTMLButtonElement>>('botonMenuMovil');

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
