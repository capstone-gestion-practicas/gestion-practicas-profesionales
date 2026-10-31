import { Injectable, signal } from '@angular/core';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { NotificacionApiService } from './notificacion-api.service';

@Injectable({ providedIn: 'root' })
export class NotificacionRealtimeService {
  readonly realtimeConectado = signal(false);
  private realtime: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;

  constructor(private readonly api: NotificacionApiService) {}

  conectar(
    idUsuario: number,
    alInsertar: (idNotificacion: number) => void
  ): Observable<unknown> {
    this.desconectar();
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
      const conectarCanal = (): void => {
        this.api.obtenerTokenRealtime().subscribe({
          next: ({ token }) => {
            void this.abrirCanal(token, idUsuario, alInsertar, activo, subscriber);
          },
          error: error => {
            console.warn('[Notificaciones] No se pudo obtener el token Realtime.', error);
            subscriber.error(error);
          }
        });
      };

      conectarCanal();
      const renovacion = window.setInterval(() => {
        this.desconectarCanal();
        conectarCanal();
      }, 8 * 60 * 1000);

      return () => {
        activo = false;
        window.clearInterval(renovacion);
        this.desconectar();
      };
    });
  }

  desconectar(): void {
    this.desconectarCanal();
    this.realtime = null;
    this.realtimeConectado.set(false);
  }

  private async abrirCanal(
    token: string,
    idUsuario: number,
    alInsertar: (idNotificacion: number) => void,
    activo: boolean,
    subscriber: { error: (error: unknown) => void }
  ): Promise<void> {
    try {
      if (!activo || !this.realtime) return;
      const realtime = this.realtime;
      await realtime.realtime.setAuth(token);
      if (!activo || this.realtime !== realtime) return;

      this.channel = realtime
        .channel(`notificaciones:${idUsuario}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notificacion',
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
    } catch (error) {
      console.warn('[Notificaciones] No se pudo abrir el canal Realtime.', error);
      subscriber.error(error);
    }
  }

  private desconectarCanal(): void {
    if (this.channel && this.realtime) void this.realtime.removeChannel(this.channel);
    this.channel = null;
    this.realtimeConectado.set(false);
  }
}
