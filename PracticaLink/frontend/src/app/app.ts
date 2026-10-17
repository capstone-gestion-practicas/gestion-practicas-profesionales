import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { EMPTY, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Notificacion } from './core/models/notificacion.models';
import { NotificacionService } from './core/services/notificacion.service';
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
  protected readonly notificacionEmergente = signal<Notificacion | null>(null);

  ngOnInit(): void {
    let usuarioActual: number | null = null;
    let idsVistos = new Set<number>();
    let primeraConsulta = true;

    timer(0, 20000).pipe(
      switchMap(() => {
        const contexto = this.authStore.obtenerContextoActual();
        if (!sessionStorage.getItem('access_token') || !contexto) {
          usuarioActual = null;
          idsVistos = new Set<number>();
          primeraConsulta = true;
          this.notificacionService.noLeidas.set(0);
          return EMPTY;
        }
        if (usuarioActual !== contexto.usuario.id_usuario) {
          usuarioActual = contexto.usuario.id_usuario;
          idsVistos = new Set<number>();
          primeraConsulta = true;
        }
        return this.notificacionService.listar().pipe(catchError(() => EMPTY));
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(resumen => {
      this.notificacionService.noLeidas.set(resumen.no_leidas);
      if (primeraConsulta) {
        idsVistos = new Set(resumen.notificaciones.map(item => item.id_notificacion));
        primeraConsulta = false;
        return;
      }
      const nuevas = resumen.notificaciones
        .filter(item => !idsVistos.has(item.id_notificacion))
        .sort((a, b) => b.id_notificacion - a.id_notificacion);
      resumen.notificaciones.forEach(item => idsVistos.add(item.id_notificacion));
      if (nuevas.length) this.mostrarNotificacion(nuevas[0]);
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
