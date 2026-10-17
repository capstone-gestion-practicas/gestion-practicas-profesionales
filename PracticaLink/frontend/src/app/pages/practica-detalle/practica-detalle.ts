import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonCard, IonCardContent, IonContent, IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { EventoHistorial, PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { formatearFechaCalendario, formatearFechaHoraChile } from '../../core/utils/fechas';

@Component({
  selector: 'app-practica-detalle', standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonCard, IonCardContent, IonContent, IonSpinner],
  templateUrl: './practica-detalle.html', styleUrl: './practica-detalle.scss'
})
export class PracticaDetalle implements OnInit, OnDestroy {
  detalle: PracticaDetalleGestionResponse | null = null;
  cargando = false;
  error = '';
  permiteReintentar = false;
  eventos: EventoHistorial[] = [];
  readonly limitHistorial = 50;
  offsetHistorial = 0;
  hayMasHistorial = false;
  cargandoHistorial = false;
  errorHistorial = '';
  historialHabilitado = false;
  confirmandoInicio = false;
  iniciando = false;
  observacionInicio = '';
  errorInicio = '';
  mensajeInicio = '';
  requiereConsultaEstado = false;
  private operacionInicio?: Subscription;
  private consultaHistorial?: Subscription;
  private idPractica = '';
  private consulta?: Subscription;
  private parametros?: Subscription;
  readonly formatearFechaHora = formatearFechaHoraChile;
  readonly formatearFecha = formatearFechaCalendario;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly practicas: PracticaService,
    private readonly auth: AuthStore
  ) {}

  ngOnInit(): void {
    this.parametros = this.route.paramMap.subscribe(parametros => {
      this.operacionInicio?.unsubscribe();
      this.iniciando = false;
      this.confirmandoInicio = false;
      this.observacionInicio = '';
      this.errorInicio = '';
      this.mensajeInicio = '';
      this.requiereConsultaEstado = false;
      this.consultaHistorial?.unsubscribe();
      this.eventos = [];
      this.offsetHistorial = 0;
      this.hayMasHistorial = false;
      this.cargandoHistorial = false;
      this.errorHistorial = '';
      this.idPractica = parametros.get('id') ?? '';
      this.cargar();
      this.historialHabilitado = this.idValido();
      if (this.historialHabilitado) this.cargarHistorial(0);
    });
  }

  ngOnDestroy(): void {
    this.operacionInicio?.unsubscribe();
    this.parametros?.unsubscribe();
    this.consultaHistorial?.unsubscribe();
    this.consulta?.unsubscribe();
  }

  cargar(): void {
    this.consulta?.unsubscribe();
    this.detalle = null;
    this.error = '';
    this.permiteReintentar = false;
    this.cargando = false;
    if (!this.idValido()) {
      this.error = 'El identificador de práctica no es válido.';
      return;
    }
    this.cargando = true;
    this.consulta = this.practicas.obtenerDetalle(this.idPractica).subscribe({
      next: detalle => {
        this.detalle = detalle;
        this.cargando = false;
        this.requiereConsultaEstado = false;
      },
      error: (error: HttpErrorResponse) => {
        this.cargando = false;
        if (error.status === 404) {
          this.error = 'La práctica no existe.';
        } else if (error.status === 401 || error.status === 403) {
          this.error = 'Acceso denegado. Revisa tu sesión y permisos.';
        } else if (error.status === 422) {
          this.error = 'El identificador de práctica no es válido.';
        } else {
          this.error = 'No fue posible cargar la práctica. Intenta nuevamente.';
          this.permiteReintentar = true;
        }
      }
    });
  }

  get puedeIniciar(): boolean {
    const roles = this.auth.contexto()?.roles ?? [];
    return roles.some(rol => rol === 'GESTOR' || rol === 'ADMINISTRADOR')
      && this.detalle?.estado.nombre === 'APROBADA' && !this.detalle.estado.es_final;
  }

  solicitarInicio(): void {
    if (!this.puedeIniciar || this.iniciando || this.requiereConsultaEstado) return;
    this.confirmandoInicio = true;
    this.errorInicio = '';
    this.mensajeInicio = '';
  }

  cancelarInicio(): void {
    if (this.iniciando) return;
    this.confirmandoInicio = false;
    this.observacionInicio = '';
    this.errorInicio = '';
  }

  confirmarInicio(): void {
    if (!this.confirmandoInicio || !this.puedeIniciar || this.iniciando
      || this.requiereConsultaEstado) return;
    // Igual que btrim de PostgreSQL: solo espacios en los extremos.
    const observacion = this.observacionInicio.replace(/^ +| +$/g, '') || null;
    if (observacion !== null && Array.from(observacion).length > 500) {
      this.errorInicio = 'La observación debe tener como máximo 500 caracteres.';
      return;
    }
    this.iniciando = true;
    this.errorInicio = '';
    this.mensajeInicio = '';
    this.operacionInicio = this.practicas.iniciar(this.idPractica, {
      estado: 'EN_CURSO', observacion
    }).subscribe({
      next: () => {
        this.iniciando = false;
        this.confirmandoInicio = false;
        this.observacionInicio = '';
        this.mensajeInicio = 'La práctica se inició correctamente.';
        this.consultarEstado();
      },
      error: (error: HttpErrorResponse) => {
        this.iniciando = false;
        this.confirmandoInicio = false;
        this.requiereConsultaEstado = true;
        if (error.status === 409) {
          this.errorInicio = 'No se pudo iniciar por un conflicto con el estado o historial. Se actualizará la información.';
          this.consultarEstado();
        } else if (error.status === 503) {
          this.errorInicio = 'El servicio de inicio no está disponible. Consulta nuevamente el estado antes de intentarlo.';
        } else if (error.status === 401 || error.status === 403) {
          this.errorInicio = 'Acceso denegado. Revisa tu sesión y permisos.';
        } else if (error.status === 422) {
          this.errorInicio = 'La solicitud de inicio no es válida. Consulta el estado antes de intentarlo nuevamente.';
        } else {
          this.errorInicio = 'No se pudo confirmar el resultado. Consulta nuevamente el estado; la aplicación no reenviará la solicitud automáticamente.';
        }
      }
    });
  }

  consultarEstado(): void {
    if (this.iniciando) return;
    this.cargar();
    this.cargarHistorial(0);
  }

  private idValido(): boolean {
    return /^[1-9][0-9]{0,18}$/.test(this.idPractica)
      && BigInt(this.idPractica) <= 9223372036854775807n;
  }

  cargarHistorial(offset = this.offsetHistorial): void {
    if (!this.idValido()) return;
    this.consultaHistorial?.unsubscribe();
    this.offsetHistorial = offset;
    this.eventos = [];
    this.hayMasHistorial = false;
    this.errorHistorial = '';
    this.cargandoHistorial = true;
    this.consultaHistorial = this.practicas.obtenerHistorial(
      this.idPractica, this.limitHistorial, offset
    ).subscribe({
      next: historial => {
        this.eventos = historial.items;
        this.hayMasHistorial = historial.hay_mas;
        this.cargandoHistorial = false;
      },
      error: (error: HttpErrorResponse) => {
        this.cargandoHistorial = false;
        this.errorHistorial = error.status === 401 || error.status === 403
          ? 'Acceso denegado al historial. Revisa tu sesión y permisos.'
          : error.status === 404
            ? 'La práctica no existe.'
            : 'No fue posible cargar el historial. Intenta nuevamente.';
      }
    });
  }

  anteriorHistorial(): void {
    if (!this.cargandoHistorial && this.offsetHistorial > 0) {
      this.cargarHistorial(Math.max(0, this.offsetHistorial - this.limitHistorial));
    }
  }

  siguienteHistorial(): void {
    if (!this.cargandoHistorial && this.hayMasHistorial) {
      this.cargarHistorial(this.offsetHistorial + this.limitHistorial);
    }
  }

  volver(): void { this.router.navigate(['/practicas']); }
}
