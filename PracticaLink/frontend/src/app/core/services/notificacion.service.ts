import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';
import { NotificacionesResumen } from '../models/notificacion.models';

@Injectable({ providedIn: 'root' })
export class NotificacionService {
  private readonly apiUrl = `${environment.apiUrl}/notificaciones`;
  readonly noLeidas = signal(0);
  readonly realtimeConectado = signal(false);
  private realtime: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;

  constructor(private readonly http: HttpClient) {}

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
}
