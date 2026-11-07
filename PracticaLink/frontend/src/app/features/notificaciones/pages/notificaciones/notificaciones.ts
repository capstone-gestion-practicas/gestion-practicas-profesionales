import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit, Optional } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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
  IonIcon,
  IonSpinner
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  chatbubbleEllipsesOutline,
  checkmarkDoneOutline,
  checkmarkOutline,
  documentTextOutline,
  flagOutline,
  megaphoneOutline,
  notificationsOutline,
  swapHorizontalOutline
} from 'ionicons/icons';

import { Notificacion } from '../../models/notificacion.models';
import { NotificacionService } from '../../services/notificacion.service';
import { AuthStore } from '../../../../core/store/auth.store';
import { esEspacioGestorDedicado } from '../../../../core/navigation/espacio-gestor';
import { ESPACIO_PAGINA } from '../../../../core/navigation/espacio-pagina.token';
import {
  FILTROS_SECCION,
  GrupoFecha,
  SeccionNotificacion,
  fechaExacta,
  fechaRelativa,
  grupoFecha,
  perteneceASeccion,
  presentarNotificacion
} from './presentacion-notificacion';

/** Clave de localStorage: decisión «Ahora no» del aviso de push. */
export const CLAVE_AVISO_PUSH_OCULTO = 'pl.push.aviso-ocultado';

/** Filtros del gestor: todas, no leídas o una sección. */
export type FiltroGestor = 'todas' | 'no_leidas' | SeccionNotificacion;

export interface GrupoNotificaciones {
  titulo: GrupoFecha;
  items: Notificacion[];
}

@Component({
  selector: 'app-notificaciones',
  standalone: true,
  imports: [CommonModule, IonBadge, IonButton, IonCard, IonCardContent,
    IonContent, IonGrid, IonRow, IonCol, IonIcon, IonSpinner, RouterLink],
  templateUrl: './notificaciones.html',
  styleUrl: './notificaciones.scss'
})
export class Notificaciones implements OnInit {
  notificaciones: Notificacion[] = [];
  cargando = true;
  error = '';
  actualizando = false;
  mensajePush = '';
  filtro: FiltroGestor = 'todas';
  /** Clave de «Ahora no» leída una vez; localStorage puede no estar disponible. */
  private avisoPushOculto = this.leerAvisoOculto();

  readonly filtrosSeccion = FILTROS_SECCION;

  constructor(
    readonly servicio: NotificacionService,
    private readonly authStore: AuthStore,
    private readonly router: Router,
    @Optional() @Inject(ESPACIO_PAGINA) private readonly espacio: 'estudiante' | null = null
  ) {
    addIcons({
      checkmarkOutline, notificationsOutline, documentTextOutline, chatbubbleEllipsesOutline,
      flagOutline, swapHorizontalOutline, checkmarkDoneOutline, megaphoneOutline
    });
  }

  /** Contadores reales derivados de la lista cargada. */
  get totalNotificaciones(): number {
    return this.notificaciones.length;
  }

  get totalNoLeidas(): number {
    return this.notificaciones.filter(item => !item.fecha_leida).length;
  }

  /** Lista visible en la presentación del estudiante (filtro Todas / No leídas). */
  get visibles(): Notificacion[] {
    return this.presentacionEstudiante && this.filtro === 'no_leidas'
      ? this.notificaciones.filter(item => !item.fecha_leida)
      : this.notificaciones;
  }

  /** Presentación del espacio V3 del estudiante. Lo define la ruta, no la URL. */
  get presentacionEstudiante(): boolean {
    return this.espacio === 'estudiante';
  }

  /** Presentación nueva solo para el gestor sin administración; el administrador conserva la anterior. */
  get presentacionGestor(): boolean {
    return !this.presentacionEstudiante && esEspacioGestorDedicado(this.authStore.obtenerContextoActual());
  }

  get subtituloGestor(): string {
    const pendientes = this.servicio.noLeidas();
    return pendientes > 0 ? `Tienes ${pendientes} sin leer.` : 'Estás al día.';
  }

  /** Notificaciones que pasan el filtro del gestor, de la más reciente a la más antigua. */
  get visiblesGestor(): Notificacion[] {
    const filtrados = this.notificaciones.filter(item => {
      if (this.filtro === 'todas') return true;
      if (this.filtro === 'no_leidas') return !item.fecha_leida;
      return perteneceASeccion(item, this.filtro);
    });
    return [...filtrados].sort((a, b) => Date.parse(b.fecha_creacion) - Date.parse(a.fecha_creacion));
  }

  /** Grupos por fecha, sin grupos vacíos y en orden Hoy, Esta semana, Anteriores. */
  get gruposGestor(): GrupoNotificaciones[] {
    const orden: GrupoFecha[] = ['Hoy', 'Esta semana', 'Anteriores'];
    const grupos = new Map<GrupoFecha, Notificacion[]>();
    for (const item of this.visiblesGestor) {
      const titulo = grupoFecha(item.fecha_creacion);
      grupos.set(titulo, [...(grupos.get(titulo) ?? []), item]);
    }
    return orden
      .filter(titulo => grupos.has(titulo))
      .map(titulo => ({ titulo, items: grupos.get(titulo) ?? [] }));
  }

  totalSeccion(seccion: SeccionNotificacion): number {
    return this.notificaciones.filter(item => perteneceASeccion(item, seccion)).length;
  }

  elegirFiltro(filtro: FiltroGestor): void {
    this.filtro = filtro;
  }

  /**
   * Estado del aviso de push: pendiente (permiso por pedir), concedido o ninguno.
   * Con permiso denegado o sin soporte no se muestra nada.
   */
  get estadoPermisoPush(): 'pendiente' | 'concedido' | 'ninguno' {
    if (typeof Notification === 'undefined') return 'ninguno';
    if (Notification.permission === 'granted') return 'concedido';
    if (Notification.permission === 'default' && !this.avisoPushOculto) return 'pendiente';
    return 'ninguno';
  }

  presentacion(notificacion: Notificacion) {
    return presentarNotificacion(notificacion.tipo);
  }

  fechaRelativa(notificacion: Notificacion): string {
    return fechaRelativa(notificacion.fecha_creacion);
  }

  fechaExacta(notificacion: Notificacion): string {
    return fechaExacta(notificacion.fecha_creacion);
  }

  /** Acción según el tipo: comandos de ruta de la entidad, o null si no hay entidad. */
  accionDe(notificacion: Notificacion): { etiqueta: string; comandos: unknown[] } | null {
    const accion = presentarNotificacion(notificacion.tipo).accion;
    if (!accion || notificacion.id_practica === null) return null;
    return { etiqueta: accion.etiqueta, comandos: accion.ruta(notificacion.id_practica) };
  }

  ahoraNo(): void {
    this.avisoPushOculto = true;
    try {
      localStorage.setItem(CLAVE_AVISO_PUSH_OCULTO, '1');
    } catch {
      // Sin localStorage el aviso se oculta solo en esta visita.
    }
  }

  activarPush(): Promise<void> {
    return this.habilitarPush();
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

  /** Marca una notificación como leída sin cambiar de pantalla (botón ✓ y acciones). */
  marcarComoLeida(notificacion: Notificacion): void {
    if (notificacion.fecha_leida) return;
    this.servicio.marcarLeida(notificacion.id_notificacion).subscribe({
      next: () => {
        notificacion.fecha_leida = new Date().toISOString();
        this.servicio.noLeidas.update(actual => Math.max(0, actual - 1));
      },
      error: () => { /* La notificación sigue sin leer; el usuario puede reintentar. */ }
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

  mostrarVolver(): boolean {
    return !esEspacioGestorDedicado(this.authStore.obtenerContextoActual());
  }

  volver(): void {
    this.router.navigate(this.enEspacioEstudiante() ? ['/estudiante/inicio'] : ['/home']);
  }

  private enEspacioEstudiante(): boolean {
    return this.router.url.split(/[?#]/, 1)[0].startsWith('/estudiante/');
  }

  private leerAvisoOculto(): boolean {
    try {
      return localStorage.getItem(CLAVE_AVISO_PUSH_OCULTO) === '1';
    } catch {
      return false;
    }
  }
}
