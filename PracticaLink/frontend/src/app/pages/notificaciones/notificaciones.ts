import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
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

import { Notificacion } from '../../core/models/notificacion.models';
import { NotificacionService } from '../../core/services/notificacion.service';

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

  constructor(
    readonly servicio: NotificacionService,
    private readonly router: Router
  ) {}

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
      const habilitado = await this.servicio.pedirPermisoPush();
      this.mensajePush = habilitado
        ? 'Permiso concedido. Registrando el dispositivo con el servidor…'
        : 'Permiso denegado. Activa las notificaciones de PracticaLink en los ajustes de Android.';
    } catch {
      this.mensajePush = 'No fue posible activar las notificaciones push.';
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
        this.router.navigate(['/home']);
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

  volver(): void { this.router.navigate(['/home']); }
}
