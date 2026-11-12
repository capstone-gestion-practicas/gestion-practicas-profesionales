import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, OnInit, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore } from '../../../../core/store/auth.store';
import { esEspacioGestorDedicado, muestraEspacioGestor } from '../../../../core/navigation/espacio-gestor';
import { RecordatoriosEstudiantes } from '../../../gestor/recordatorios/recordatorios-estudiantes';
import { muestraEspacioAdministrador } from '../../../../core/navigation/espacio-administrador';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonGrid,
  IonCol,
  IonRow,
  IonSpinner
} from '@ionic/angular';

import { DestinatarioMensajePush } from '../../models/notificacion.models';
import { NotificacionService } from '../../services/notificacion.service';

@Component({
  selector: 'app-envio-notificaciones',
  standalone: true,
  imports: [
    CommonModule,
    RecordatoriosEstudiantes,
    FormsModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonContent,
    IonGrid,
    IonCol,
    IonRow,
    IonSpinner
  ],
  templateUrl: './envio-notificaciones.html',
  styleUrl: './envio-notificaciones.scss'
})
export class EnvioNotificaciones implements OnInit, AfterViewInit {
  get espacioAdmin(): boolean { return muestraEspacioAdministrador(this.authStore.contexto()); }
  private readonly authStore = inject(AuthStore);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly recordatorios = viewChild<ElementRef<HTMLElement>>('recordatorios');
  ngAfterViewInit(): void {
    if (this.route?.snapshot.fragment === 'recordatorios') this.recordatorios()?.nativeElement.scrollIntoView({ block: 'start' });
  }
  destinatarios: DestinatarioMensajePush[] = [];
  modoEnvio: 'individual' | 'broadcast' = 'individual';
  destinatarioId = '';
  titulo = '';
  mensaje = '';
  cargandoDestinatarios = true;
  enviando = false;
  get espacioGestor(): boolean { return muestraEspacioGestor(this.authStore.contexto()); }
  estadoEnvio = '';
  error = '';

  constructor(
    private readonly servicio: NotificacionService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.cargarDestinatarios();
  }

  cargarDestinatarios(): void {
    this.cargandoDestinatarios = true;
    this.error = '';
    this.servicio.listarDestinatariosPush().subscribe({
      next: destinatarios => {
        this.destinatarios = destinatarios;
        if (!this.destinatarioId && destinatarios.length) {
          this.destinatarioId = String(destinatarios[0].id_usuario);
        }
        this.cargandoDestinatarios = false;
      },
      error: () => {
        this.error = 'No fue posible cargar los estudiantes activos.';
        this.cargandoDestinatarios = false;
      }
    });
  }

  enviar(): void {
    if (this.enviando) return;
    const titulo = this.titulo.trim();
    const mensaje = this.mensaje.trim();
    this.estadoEnvio = '';
    this.error = '';

    if (!titulo || !mensaje) {
      this.error = 'Completa el título y el mensaje.';
      return;
    }

    if (this.modoEnvio === 'broadcast') {
      if (!this.destinatarios.length) {
        this.error = 'No hay estudiantes activos para el envío.';
        return;
      }
      if (!window.confirm(`¿Enviar este mensaje a los ${this.destinatarios.length} estudiantes activos?`)) {
        return;
      }

      this.enviando = true;
      this.servicio.enviarBroadcastPersonalizado({ titulo, mensaje }).subscribe({
        next: respuesta => this.completarEnvio(respuesta.mensaje),
        error: error => this.fallarEnvio(error, 'No fue posible enviar el mensaje a todos los estudiantes.')
      });
      return;
    }

    const idUsuario = Number(this.destinatarioId);
    if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
      this.error = 'Selecciona un estudiante.';
      return;
    }

    this.enviando = true;
    this.servicio.enviarMensajePersonalizado({ id_usuario: idUsuario, titulo, mensaje }).subscribe({
      next: respuesta => this.completarEnvio(respuesta.mensaje),
      error: error => this.fallarEnvio(error, 'No fue posible enviar el mensaje.')
    });
  }

  mostrarVolver(): boolean {
    return !esEspacioGestorDedicado(this.authStore.obtenerContextoActual());
  }

  volver(): void {
    void this.router.navigate(['/home']);
  }

  private completarEnvio(mensaje: string): void {
    this.enviando = false;
    this.estadoEnvio = mensaje;
    this.titulo = '';
    this.mensaje = '';
  }

  private fallarEnvio(error: HttpErrorResponse, mensajePredeterminado: string): void {
    this.enviando = false;
    this.error = typeof error.error?.detail === 'string'
      ? error.error.detail
      : mensajePredeterminado;
  }
}
