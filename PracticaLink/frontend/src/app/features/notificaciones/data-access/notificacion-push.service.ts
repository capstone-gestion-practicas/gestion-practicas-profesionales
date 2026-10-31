import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { ActionPerformed, PushNotifications, Token } from '@capacitor/push-notifications';

import { NotificacionApiService } from './notificacion-api.service';

@Injectable({ providedIn: 'root' })
export class NotificacionPushService {
  readonly dispositivoPushRegistrado = signal(false);
  readonly estadoRegistroPush = signal<'inactivo' | 'registrando' | 'registrado' | 'error'>(
    'inactivo'
  );
  readonly notificacionAbiertaPorPush = signal<number | null>(null);
  private pushListenersRegistrados = false;
  private timeoutRegistroPush: number | null = null;

  constructor(private readonly api: NotificacionApiService) {}

  esAndroid(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  async iniciarPush(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    await this.asegurarListenersPush();
    await this.prepararNotificacionesAndroid();
    await this.registrarTokenSiAutorizado();
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

  desregistrarPush(): void {
    if (!Capacitor.isNativePlatform()) return;
    this.api.eliminarDispositivoActual().subscribe({
      error: error => console.warn('[Push] No se pudo desvincular el dispositivo.', error)
    });
  }

  private async registrarTokenSiAutorizado(): Promise<void> {
    const permiso = await PushNotifications.checkPermissions();
    if (permiso.receive === 'granted') await this.registrarPush();
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
      this.api.registrarDispositivo(token.value, Capacitor.getPlatform()).subscribe({
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
    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action: ActionPerformed) => {
        const id = Number(action.notification.data?.['id_notificacion']);
        this.notificacionAbiertaPorPush.set(Number.isFinite(id) ? id : Date.now());
      }
    );
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
}
