import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  DestinatarioMensajePush,
  EnviarBroadcastPushResponse,
  EnviarMensajePushResponse,
  NotificacionesResumen
} from '../models/notificacion.models';

@Injectable({ providedIn: 'root' })
export class NotificacionApiService {
  private readonly apiUrl = `${environment.apiUrl}/notificaciones`;

  constructor(private readonly http: HttpClient) {}

  listar(): Observable<NotificacionesResumen> {
    return this.http.get<NotificacionesResumen>(this.apiUrl);
  }

  marcarLeida(id: number): Observable<void> {
    return this.http.patch<void>(`${this.apiUrl}/${id}/leida`, {});
  }

  marcarTodasLeidas(): Observable<{ actualizadas: number }> {
    return this.http.patch<{ actualizadas: number }>(`${this.apiUrl}/leidas`, {});
  }

  registrarDispositivo(token: string, plataforma: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/dispositivos`, { token, plataforma });
  }

  eliminarDispositivoActual(): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/dispositivos/actual`);
  }

  obtenerTokenRealtime(): Observable<{ token: string }> {
    return this.http.get<{ token: string }>(`${this.apiUrl}/realtime-token`);
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
      `${this.apiUrl}/mensaje-personalizado`,
      datos
    );
  }

  enviarBroadcastPersonalizado(datos: {
    titulo: string;
    mensaje: string;
  }): Observable<EnviarBroadcastPushResponse> {
    return this.http.post<EnviarBroadcastPushResponse>(
      `${this.apiUrl}/mensaje-broadcast`,
      datos
    );
  }
}
