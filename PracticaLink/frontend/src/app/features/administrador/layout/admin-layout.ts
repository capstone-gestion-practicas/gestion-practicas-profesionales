import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AuthStore } from '../../../core/store/auth.store';
import { SesionService } from '../../../core/session/sesion.service';
import { NotificacionService } from '../../notificaciones/services/notificacion.service';
import { BrandMark } from '../../../shared/components/brand-mark/brand-mark';

export function seccionAdmin(url: string): string | null {
  const ruta = url.split(/[?#]/)[0];
  if (ruta === '/home') return 'Inicio';
  if (ruta === '/usuarios') return 'Usuarios';
  if (ruta === '/gestion-estados') return 'Asignaciones';
  if (/^\/(practicas|seguimientos|incidencias)(\/|$)/.test(ruta)) return 'Supervisión';
  if (ruta === '/envio-notificaciones' || ruta === '/notificaciones') return 'Comunicaciones';
  return null;
}

@Component({
  selector: 'app-admin-layout', standalone: true,
  imports: [RouterLink, BrandMark],
  templateUrl: './admin-layout.html',
  // Reutilización de identidad y responsive, sin modificar el shell del GESTOR.
  styleUrls: ['../../../pages/home/gestor-home/gestor-header/gestor-header.scss', './admin-layout.scss']
})
export class AdminLayout {
  readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly sesion = inject(SesionService);
  readonly noLeidas = inject(NotificacionService).noLeidas;
  readonly movil = signal(false);
  readonly cuenta = signal(false);
  readonly destinos = [
    { nombre: 'Inicio', ruta: '/home' }, { nombre: 'Usuarios', ruta: '/usuarios' },
    { nombre: 'Asignaciones', ruta: '/gestion-estados' }, { nombre: 'Supervisión', ruta: '/practicas' },
    { nombre: 'Comunicaciones', ruta: '/envio-notificaciones' }
  ];
  private readonly url = toSignal(this.router.events.pipe(
    filter((evento): evento is NavigationEnd => evento instanceof NavigationEnd),
    map(evento => { this.movil.set(false); this.cuenta.set(false); return evento.urlAfterRedirects; })
  ), { initialValue: this.router.url });
  readonly activa = computed(() => seccionAdmin(this.url()));
  readonly nombre = computed(() => this.auth.contexto()?.usuario.nombre ?? 'Cuenta');
  readonly correo = computed(() => this.auth.contexto()?.usuario.correo ?? '');
  private readonly botonMovil = viewChild<ElementRef<HTMLButtonElement>>('botonMovil');
  private readonly menuCuenta = viewChild<ElementRef<HTMLElement>>('menuCuenta');

  cerrarMenu(): void { this.movil.set(false); this.botonMovil()?.nativeElement.focus(); }
  salir(): void { this.sesion.cerrar(); }

  @HostListener('document:keydown.escape')
  escapar(): void {
    if (this.cuenta()) {
      this.cuenta.set(false);
      this.menuCuenta()?.nativeElement.querySelector('button')?.focus();
    } else this.cerrarMenu();
  }

  @HostListener('document:click', ['$event'])
  cerrarCuentaFuera(evento: Event): void {
    if (!this.menuCuenta()?.nativeElement.contains(evento.target as Node)) this.cuenta.set(false);
  }
}
