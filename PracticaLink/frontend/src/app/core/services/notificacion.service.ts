import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications, Token, ActionPerformed } from '@capacitor/push-notifications';

import { environment } from '../../../environments/environment';
import {
  DestinatarioMensajePush,
  EnviarBroadcastPushResponse,
  EnviarMensajePushResponse,
  NotificacionesResumen
} from '../models/notificacion.models';

@Injectable({ providedIn: 'root' })
export class NotificacionService {
  private readonly apiUrl = `${environment.apiUrl}/notificaciones`;
  readonly noLeidas = signal(0);
  readonly realtimeConectado = signal(false);
  readonly dispositivoPushRegistrado = signal(false);
  readonly estadoRegistroPush = signal<'inactivo' | 'registrando' | 'registrado' | 'error'>(
    'inactivo'
  );
  readonly notificacionAbiertaPorPush = signal<number | null>(null);
  private realtime: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private pushListenersRegistrados = false;
  private timeoutRegistroPush: number | null = null;

  constructor(private readonly http: HttpClient) {}

  esAndroid(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  async iniciarPush(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    await this.asegurarListenersPush();
    await this.prepararNotificacionesAndroid();
    await this.registrarTokenSiAutorizado();
  }

  private async registrarTokenSiAutorizado(): Promise<void> {
    const permiso = await PushNotifications.checkPermissions();
    if (permiso.receive === 'granted') await this.registrarPush();
  }

  async pedirPermisoPush(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    await this.asegurarListenersPush();
    await this.prepararNotificacionesAndroid();
    let permiso = await PushNotifications.checkPermissions();
    if (permiso.receive === 'prompt' || permiso.receive === 'prompt-with-rationale') {
      permiso = await PushNotifications.requestPermissions();
    }
    if (permiso.receive === 'granted') {
      await this.registrarPush();
      return true;
    }
    return false;
  }

  private async registrarPush(): Promise<void> {
    this.dispositivoPushRegistrado.set(false);
    this.estadoRegistroPush.set('registrando');
    this.iniciarTimeoutRegistroPush();
    try {
      await PushNotifications.register();
    } catch (error) {
      this.limpiarTimeoutRegistroPush();
      this.dispositivoPushRegistrado.set(false);
      this.estadoRegistroPush.set('error');
      throw error;
    }
  }

  private async asegurarListenersPush(): Promise<void> {
    if (this.pushListenersRegistrados) return;
    this.pushListenersRegistrados = true;
    await PushNotifications.addListener('registration', (token: Token) => {
      this.estadoRegistroPush.set('registrando');
      this.iniciarTimeoutRegistroPush();
      this.http.post(`${this.apiUrl}/dispositivos`, {
        token: token.value,
        plataforma: Capacitor.getPlatform()
      }).subscribe({
        next: () => {
          this.limpiarTimeoutRegistroPush();
          this.dispositivoPushRegistrado.set(true);
          this.estadoRegistroPush.set('registrado');
        },
        error: error => {
          this.limpiarTimeoutRegistroPush();
          this.dispositivoPushRegistrado.set(false);
          this.estadoRegistroPush.set('error');
          console.warn('[Push] No se pudo registrar el dispositivo.', error);
        }
      });
    });
    await PushNotifications.addListener('registrationError', error => {
      this.limpiarTimeoutRegistroPush();
      this.dispositivoPushRegistrado.set(false);
      this.estadoRegistroPush.set('error');
      console.warn('[Push] Falló el registro del dispositivo.', error);
    });
    await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      const id = Number(action.notification.data?.['id_notificacion']);
      this.notificacionAbiertaPorPush.set(Number.isFinite(id) ? id : Date.now());
    });
    await PushNotifications.addListener('pushNotificationReceived', notification => {
      if (Capacitor.getPlatform() !== 'android') return;
      void this.mostrarNotificacionAndroid(notification).catch(error =>
        console.warn('[Push] No se pudo mostrar la notificación del sistema.', error)
      );
    });
    await LocalNotifications.addListener('localNotificationActionPerformed', action => {
      const id = Number(action.notification.extra?.['id_notificacion']);
      this.notificacionAbiertaPorPush.set(Number.isFinite(id) ? id : Date.now());
    });
  }

  private async prepararNotificacionesAndroid(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android') return;
    await LocalNotifications.createChannel({
      id: 'practicalink-notificaciones',
      name: 'Notificaciones de PracticaLink',
      description: 'Avisos sobre prácticas profesionales',
      importance: 4,
      visibility: 1,
      vibration: true
    });
  }

  private async mostrarNotificacionAndroid(
    notificacion: { title?: string | null; body?: string | null; data?: Record<string, unknown> }
  ): Promise<void> {
    const permiso = await LocalNotifications.checkPermissions();
    if (permiso.display !== 'granted') {
      console.warn('[Push] Android no autorizó mostrar notificaciones del sistema.');
      return;
    }

    const idNotificacion = Number(notificacion.data?.['id_notificacion']);
    const idSistema = Number.isInteger(idNotificacion)
      && idNotificacion > 0
      && idNotificacion <= 2_147_483_647
      ? idNotificacion
      : Math.max(1, Date.now() % 2_147_483_647);

    await LocalNotifications.schedule({
      notifications: [{
        id: idSistema,
        title: notificacion.title || 'PracticaLink',
        body: notificacion.body || 'Tienes una nueva notificación.',
        channelId: 'practicalink-notificaciones',
        schedule: { at: new Date(Date.now() + 500) },
        extra: { id_notificacion: idNotificacion }
      }]
    });
  }

  private limpiarTimeoutRegistroPush(): void {
    if (this.timeoutRegistroPush !== null) {
      window.clearTimeout(this.timeoutRegistroPush);
      this.timeoutRegistroPush = null;
    }
  }

  private iniciarTimeoutRegistroPush(): void {
    this.limpiarTimeoutRegistroPush();
    this.timeoutRegistroPush = window.setTimeout(() => {
      this.timeoutRegistroPush = null;
      this.dispositivoPushRegistrado.set(false);
      this.estadoRegistroPush.set('error');
    }, 25000);
  }

  desregistrarPush(): void {
    if (!Capacitor.isNativePlatform()) return;
    this.http.delete(`${this.apiUrl}/dispositivos/actual`).subscribe({
      error: error => console.warn('[Push] No se pudo desvincular el dispositivo.', error)
    });
  }

  conectarRealtime(
    idUsuario: number,
    alInsertar: (idNotificacion: number) => void
  ): Observable<unknown> {
    this.desconectarRealtime();
    if (!environment.supabaseUrl || !environment.supabasePublishableKey) {
      return new Observable(subscriber => {
        subscriber.error(new Error('Falta configurar Supabase Realtime en el frontend'));
      });
    }

    this.realtime = createClient(environment.supabaseUrl, environment.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return new Observable(subscriber => {
      let activo = true;
      const conectar = (): void => {
        this.http.get<{ token: string }>(`${this.apiUrl}/realtime-token`).subscribe({
          next: async ({ token }) => {
            if (!activo || !this.realtime) return;
            await this.realtime.realtime.setAuth(token);
            if (!activo || !this.realtime) return;
            this.channel = this.realtime
              .channel(`notificaciones:${idUsuario}`)
              .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'notificacion',
                filter: `id_usuario=eq.${idUsuario}`
              }, payload => {
                const id = Number(payload.new['id_notificacion']);
                if (Number.isFinite(id)) alInsertar(id);
              })
              .subscribe(status => {
                this.realtimeConectado.set(status === 'SUBSCRIBED');
                if (status === 'SUBSCRIBED') {
                  console.info('[Notificaciones] Supabase Realtime conectado.');
                }
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                  console.warn(`[Notificaciones] Canal Realtime: ${status}.`);
                  subscriber.error(new Error(`Estado del canal Supabase: ${status}`));
                }
              });
          },
          error: error => {
            console.warn('[Notificaciones] No se pudo obtener el token Realtime.', error);
            subscriber.error(error);
          }
        });
      };
      conectar();
      const renovacion = window.setInterval(() => {
        this.desconectarCanal();
        conectar();
      }, 8 * 60 * 1000);
      return () => {
        activo = false;
        window.clearInterval(renovacion);
        this.desconectarRealtime();
      };
    });
  }

  desconectarRealtime(): void {
    this.desconectarCanal();
    this.realtime = null;
    this.realtimeConectado.set(false);
  }

  private desconectarCanal(): void {
    if (this.channel && this.realtime) void this.realtime.removeChannel(this.channel);
    this.channel = null;
    this.realtimeConectado.set(false);
  }

  listar(): Observable<NotificacionesResumen> {
    return this.http.get<NotificacionesResumen>(this.apiUrl);
  }

  marcarLeida(id: number): Observable<void> {
    return this.http.patch<void>(`${this.apiUrl}/${id}/leida`, {});
  }

  marcarTodasLeidas(): Observable<{ actualizadas: number }> {
    return this.http.patch<{ actualizadas: number }>(`${this.apiUrl}/leidas`, {});
  }

  listarDestinatariosPush(): Observable<DestinatarioMensajePush[]> {
    return this.http.get<DestinatarioMensajePush[]>(`${this.apiUrl}/destinatarios-push`);
  }

  enviarMensajePersonalizado(datos: {
    id_usuario: number;
    titulo: string;
    mensaje: string;
  }): Observable<EnviarMensajePushResponse> {
    return this.http.post<EnviarMensajePushResponse>(
      `${this.apiUrl}/mensaje-personalizado`, datos
    );
  }

  enviarBroadcastPersonalizado(datos: {
    titulo: string;
    mensaje: string;
  }): Observable<EnviarBroadcastPushResponse> {
    return this.http.post<EnviarBroadcastPushResponse>(
      `${this.apiUrl}/mensaje-broadcast`, datos
    );
  }
}
