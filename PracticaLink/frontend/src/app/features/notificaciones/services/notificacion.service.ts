import { inject, Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';

import {
  DestinatarioMensajePush,
  EnviarBroadcastPushResponse,
  EnviarMensajePushResponse,
  NotificacionesResumen
} from '../models/notificacion.models';
import { NotificacionApiService } from '../data-access/notificacion-api.service';
import { NotificacionPushService } from '../data-access/notificacion-push.service';
import { NotificacionRealtimeService } from '../data-access/notificacion-realtime.service';

@Injectable({ providedIn: 'root' })
export class NotificacionService {
  private readonly api = inject(NotificacionApiService);
  private readonly realtimeService = inject(NotificacionRealtimeService);
  private readonly pushService = inject(NotificacionPushService);
  readonly noLeidas = signal(0);
  readonly realtimeConectado = this.realtimeService.realtimeConectado;
  readonly dispositivoPushRegistrado = this.pushService.dispositivoPushRegistrado;
  readonly estadoRegistroPush = this.pushService.estadoRegistroPush;
  readonly notificacionAbiertaPorPush = this.pushService.notificacionAbiertaPorPush;

  esAndroid(): boolean {
    return this.pushService.esAndroid();
  }

  iniciarPush(): Promise<void> {
    return this.pushService.iniciarPush();
  }

  pedirPermisoPush(): Promise<boolean> {
    return this.pushService.pedirPermisoPush();
  }

  desregistrarPush(): void {
    this.pushService.desregistrarPush();
  }

  conectarRealtime(
    idUsuario: number,
    alInsertar: (idNotificacion: number) => void
  ): Observable<unknown> {
    return this.realtimeService.conectar(idUsuario, alInsertar);
  }

  desconectarRealtime(): void {
    this.realtimeService.desconectar();
  }

  listar(): Observable<NotificacionesResumen> {
    return this.api.listar();
  }

  marcarLeida(id: number): Observable<void> {
    return this.api.marcarLeida(id);
  }

  marcarTodasLeidas(): Observable<{ actualizadas: number }> {
    return this.api.marcarTodasLeidas();
  }

  listarDestinatariosPush(): Observable<DestinatarioMensajePush[]> {
    return this.api.listarDestinatariosPush();
  }

  enviarMensajePersonalizado(datos: {
    id_usuario: number;
    titulo: string;
    mensaje: string;
  }): Observable<EnviarMensajePushResponse> {
    return this.api.enviarMensajePersonalizado(datos);
  }

  enviarBroadcastPersonalizado(datos: {
    titulo: string;
    mensaje: string;
  }): Observable<EnviarBroadcastPushResponse> {
    return this.api.enviarBroadcastPersonalizado(datos);
  }
}
