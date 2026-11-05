import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit, Optional } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonSpinner
} from '@ionic/angular';

import { Notificacion } from '../../models/notificacion.models';
import { NotificacionService } from '../../services/notificacion.service';
import { AuthStore } from '../../../../core/store/auth.store';
import { ESPACIO_PAGINA } from '../../../../core/navigation/espacio-pagina.token';

@Component({
  selector: 'app-notificaciones',
  standalone: true,
  imports: [CommonModule, IonBadge, IonButton, IonCard, IonCardContent,
    IonContent, IonGrid, IonRow, IonCol, IonSpinner],
  templateUrl: './notificaciones.html',
  styleUrl: './notificaciones.scss'
})
export class Notificaciones implements OnInit {
  notificaciones: Notificacion[] = [];
  cargando = true;
  error = '';
  actualizando = false;
  mensajePush = '';
  filtro: 'todas' | 'no_leidas' = 'todas';

  constructor(
    readonly servicio: NotificacionService,
    private readonly authStore: AuthStore,
    private readonly router: Router,
    @Optional() @Inject(ESPACIO_PAGINA) private readonly espacio: 'estudiante' | null = null
  ) {}

  /** Contadores reales derivados de la lista cargada. */
  get totalNotificaciones(): number {
    return this.notificaciones.length;
  }

  get totalNoLeidas(): number {
    return this.notificaciones.filter(item => !item.fecha_leida).length;
  }

  /** Lista visible: el filtro solo aplica en la presentación V3 del estudiante. */
  get visibles(): Notificacion[] {
    return this.presentacionEstudiante && this.filtro === 'no_leidas'
      ? this.notificaciones.filter(item => !item.fecha_leida)
      : this.notificaciones;
  }

  elegirFiltro(filtro: 'todas' | 'no_leidas'): void {
    this.filtro = filtro;
  }

  /** Presentación del espacio V3 del estudiante. Lo define la ruta, no la URL. */
  get presentacionEstudiante(): boolean {
    return this.espacio === 'estudiante';
  }

  ngOnInit(): void {
    this.cargar();
  }

  async habilitarPush(): Promise<void> {
    this.mensajePush = '';
    if (!Capacitor.isNativePlatform()) {
      this.mensajePush = 'El registro de push debe hacerse desde la APK Android instalada, no desde el navegador.';
      return;
    }
    try {
      const idUsuario = this.authStore.obtenerContextoActual()?.usuario.id_usuario;
      if (!idUsuario) {
        this.mensajePush = 'Inicia sesión para activar las notificaciones push.';
        return;
      }
      const habilitado = await this.servicio.pedirPermisoPush(idUsuario);
      this.mensajePush = habilitado
        ? 'Permiso concedido. Registrando el dispositivo con el servidor…'
        : 'Permiso denegado. Activa las notificaciones de PracticaLink en los ajustes de Android.';
    } catch (error) {
      console.warn('[Push] No fue posible activar las notificaciones desde la pantalla.', error);
      this.mensajePush = error instanceof Error
        && error.message.includes('Firebase no está configurado')
        ? 'Esta versión de la app no tiene Firebase configurado. No se pueden activar las notificaciones push.'
        : 'No fue posible iniciar las notificaciones push. Revisa los permisos de Android y vuelve a intentarlo.';
    }
  }

  cargar(): void {
    this.cargando = true;
    this.error = '';
    this.servicio.listar().subscribe({
      next: respuesta => {
        this.notificaciones = respuesta.notificaciones;
        this.servicio.noLeidas.set(respuesta.no_leidas);
        this.cargando = false;
      },
      error: () => {
        this.error = 'No fue posible cargar las notificaciones.';
        this.cargando = false;
      }
    });
  }

  marcarTodas(): void {
    if (this.actualizando || this.servicio.noLeidas() === 0) return;
    this.actualizando = true;
    this.servicio.marcarTodasLeidas().subscribe({
      next: () => {
        this.notificaciones = this.notificaciones.map(item => ({
          ...item,
          fecha_leida: item.fecha_leida ?? new Date().toISOString()
        }));
        this.servicio.noLeidas.set(0);
        this.actualizando = false;
      },
      error: () => { this.actualizando = false; }
    });
  }

  abrir(notificacion: Notificacion): void {
    const irADestino = () => {
      if (notificacion.tipo === 'NUEVA_PRACTICA') {
        this.router.navigate(['/revisiones', notificacion.id_practica]);
      } else if (
        notificacion.tipo === 'CAMBIO_ESTADO'
        || notificacion.tipo === 'RECORDATORIO_SIN_PRACTICA'
      ) {
        this.router.navigate(this.enEspacioEstudiante() ? ['/estudiante/mi-practica'] : ['/home']);
      }
    };

    if (notificacion.fecha_leida) {
      irADestino();
      return;
    }

    this.servicio.marcarLeida(notificacion.id_notificacion).subscribe({
      next: () => {
        notificacion.fecha_leida = new Date().toISOString();
        this.servicio.noLeidas.update(actual => Math.max(0, actual - 1));
        irADestino();
      },
      error: () => irADestino()
    });
  }

  volver(): void {
    this.router.navigate(this.enEspacioEstudiante() ? ['/estudiante/inicio'] : ['/home']);
  }

  private enEspacioEstudiante(): boolean {
    return this.router.url.split(/[?#]/, 1)[0].startsWith('/estudiante/');
  }
}
