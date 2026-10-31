import { Component, DestroyRef, Injector, OnInit, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { EMPTY, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Notificacion } from './features/notificaciones/models/notificacion.models';
import { NotificacionService } from './features/notificaciones/services/notificacion.service';
import { AuthStore } from './core/store/auth.store';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('practicalink-frontend');
  private readonly notificacionService = inject(NotificacionService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  protected readonly notificacionEmergente = signal<Notificacion | null>(null);

  ngOnInit(): void {
    let usuarioActual: number | null = null;
    let idsVistos = new Set<number>();
    let primeraConsulta = true;

    effect(onCleanup => {
      const contexto = this.authStore.contexto();
      if (!sessionStorage.getItem('access_token') || !contexto) {
        usuarioActual = null;
        idsVistos = new Set<number>();
        primeraConsulta = true;
        this.notificacionService.noLeidas.set(0);
        this.notificacionService.desconectarRealtime();
        return;
      }

      usuarioActual = contexto.usuario.id_usuario;
      void this.notificacionService.iniciarPush().catch(error =>
        console.warn('[Push] No se pudo iniciar el registro.', error)
      );
      if (this.notificacionService.notificacionAbiertaPorPush() !== null) {
        this.notificacionService.notificacionAbiertaPorPush.set(null);
        void this.router.navigateByUrl('/notificaciones');
      }
      idsVistos = new Set<number>();
      primeraConsulta = true;
      const realtimeSub = this.notificacionService.conectarRealtime(usuarioActual, id => {
        this.notificacionService.listar().subscribe(resumen => {
          this.notificacionService.noLeidas.set(resumen.no_leidas);
          const nueva = resumen.notificaciones.find(item => item.id_notificacion === id);
          if (nueva) {
            idsVistos.add(id);
            if (!this.notificacionService.esAndroid()) this.mostrarNotificacion(nueva);
          }
        });
      }).pipe(catchError(() => EMPTY)).subscribe();

      // Carga inmediata al completar el login, sin esperar al timer de respaldo.
      const cargaInicial = this.notificacionService.listar().subscribe({
        next: resumen => {
          this.notificacionService.noLeidas.set(resumen.no_leidas);
          idsVistos = new Set(resumen.notificaciones.map(item => item.id_notificacion));
          primeraConsulta = false;
        },
        error: () => undefined
      });
      onCleanup(() => {
        realtimeSub.unsubscribe();
        cargaInicial.unsubscribe();
        this.notificacionService.desconectarRealtime();
      });
    }, { injector: this.injector });

    timer(0, 60000).pipe(
      switchMap(() => {
        const contexto = this.authStore.obtenerContextoActual();
        if (!sessionStorage.getItem('access_token') || !contexto) {
          return EMPTY;
        }
        if (usuarioActual !== contexto.usuario.id_usuario) {
          return EMPTY;
        }
        // El polling solo cubre períodos en que Realtime no logra conectarse.
        if (this.notificacionService.realtimeConectado()) {
          return EMPTY;
        }
        return this.notificacionService.listar().pipe(catchError(() => EMPTY));
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(resumen => {
      this.notificacionService.noLeidas.set(resumen.no_leidas);
      const nuevas = resumen.notificaciones
        .filter(item => !idsVistos.has(item.id_notificacion))
        .sort((a, b) => b.id_notificacion - a.id_notificacion);
      resumen.notificaciones.forEach(item => idsVistos.add(item.id_notificacion));
      if (!primeraConsulta && nuevas.length) this.mostrarNotificacion(nuevas[0]);
      primeraConsulta = false;
    });
  }

  private async mostrarNotificacion(notificacion: Notificacion): Promise<void> {
    this.notificacionEmergente.set(notificacion);
    window.setTimeout(() => {
      if (this.notificacionEmergente()?.id_notificacion === notificacion.id_notificacion) {
        this.notificacionEmergente.set(null);
      }
    }, 8000);
  }

  protected verNotificacion(): void {
    this.notificacionEmergente.set(null);
    void this.router.navigateByUrl('/notificaciones');
  }
}
