import { SeguimientoHistorialItem } from '../../core/models/seguimiento.models';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonContent, IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { EventoHistorial, PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import {
  RegistroPracticaLocal,
  RegistroPracticaService
} from '../../core/services/registro-practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { formatearFechaCalendario, formatearFechaHoraChile } from '../../core/utils/fechas';

@Component({
  selector: 'app-practica-detalle', standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonContent, IonSpinner],
  templateUrl: './practica-detalle.html', styleUrl: './practica-detalle.scss'
})
export class PracticaDetalle implements OnInit, OnDestroy {
  detalle: PracticaDetalleGestionResponse | null = null;
  cargando = false;
  error = '';
  permiteReintentar = false;
  eventos: EventoHistorial[] = [];
  registrosSeguimiento: SeguimientoHistorialItem[] = [];
  readonly limitSeguimientos = 50;
  offsetSeguimientos = 0;
  hayMasSeguimientos = false;
  cargandoSeguimientos = false;
  seguimientosConsultados = false;
  errorSeguimientos = '';
  private consultaSeguimientos?: Subscription;
  registrosIncidencia: RegistroPracticaLocal[] = [];
  vistaHistorial: 'seguimientos' | 'incidencias' | 'antecedentes' = 'seguimientos';
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

  get nombreUsuario(): string {
    const usuario = this.auth.contexto()?.usuario;
    return usuario ? `${usuario.nombre} ${usuario.apellido}` : 'Usuario';
  }

  get inicialesUsuario(): string {
    return this.nombreUsuario.split(/\s+/).filter(Boolean).slice(0, 2)
      .map(parte => parte.charAt(0)).join('').toUpperCase() || 'U';
  }

  navegarA(ruta: string): void {
    this.router.navigate([ruta]);
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly practicas: PracticaService,
    private readonly auth: AuthStore,
    private readonly registros: RegistroPracticaService
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
      this.consultaSeguimientos?.unsubscribe();
      this.registrosSeguimiento = [];
      this.offsetSeguimientos = 0;
      this.hayMasSeguimientos = false;
      this.cargandoSeguimientos = false;
      this.seguimientosConsultados = false;
      this.errorSeguimientos = '';
      this.idPractica = parametros.get('id') ?? '';
      const registros = this.registros.listar(this.idPractica);
      this.registrosIncidencia = registros
        .filter(registro => registro.tipo === 'incidencia');
      this.vistaHistorial = 'seguimientos';
      this.cargar();
      this.historialHabilitado = this.idValido();
      if (this.historialHabilitado) {
        this.cargarHistorial(0);
        this.cargarSeguimientos(0);
      }
    });
  }

  ngOnDestroy(): void {
    this.consultaSeguimientos?.unsubscribe();
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

  registrarSeguimiento(): void {
    this.router.navigate(['/practicas', this.idPractica, 'seguimiento', 'nuevo']);
  }

  registrarIncidencia(): void {
    this.router.navigate(['/practicas', this.idPractica, 'incidencias', 'nueva']);
  }

  seleccionarVista(vista: 'seguimientos' | 'incidencias' | 'antecedentes'): void {
    this.vistaHistorial = vista;
  }

  formatearFechaRegistro(fecha: string): string {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    if (!anio || !mes || !dia) return fecha;
    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit', month: 'short', year: 'numeric'
    }).format(new Date(anio, mes - 1, dia));
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

  cargarSeguimientos(offset = this.offsetSeguimientos): void {
    if (!this.idValido() || this.cargandoSeguimientos) return;
    this.consultaSeguimientos?.unsubscribe();
    this.offsetSeguimientos = offset;
    this.registrosSeguimiento = [];
    this.hayMasSeguimientos = false;
    this.seguimientosConsultados = false;
    this.errorSeguimientos = '';
    this.cargandoSeguimientos = true;
    this.consultaSeguimientos = this.practicas.obtenerSeguimientos(
      this.idPractica, this.limitSeguimientos, offset
    ).subscribe({
      next: historial => {
        this.registrosSeguimiento = historial.items;
        this.hayMasSeguimientos = historial.hay_mas;
        this.cargandoSeguimientos = false;
        this.seguimientosConsultados = true;
      },
      error: (error: HttpErrorResponse) => {
        this.cargandoSeguimientos = false;
        const mensajes: Record<number, string> = {
          401: 'Tu sesión no es válida. Inicia sesión nuevamente.',
          403: 'Acceso denegado al historial de seguimientos.',
          404: 'La práctica no está disponible.',
          422: 'Los parámetros de consulta no son válidos.',
          500: 'El servidor no pudo consultar los seguimientos.',
          503: 'El servicio de seguimientos está temporalmente no disponible.'
        };
        this.errorSeguimientos = mensajes[error.status]
          ?? 'No fue posible conectar para consultar los seguimientos.';
        if (error.status === 401) {
          sessionStorage.removeItem('access_token');
          this.auth.limpiar();
          this.router.navigate(['/login']);
        }
      }
    });
  }

  anteriorSeguimientos(): void {
    if (!this.cargandoSeguimientos && this.offsetSeguimientos > 0) {
      this.cargarSeguimientos(Math.max(0, this.offsetSeguimientos - this.limitSeguimientos));
    }
  }

  siguienteSeguimientos(): void {
    if (!this.cargandoSeguimientos && this.hayMasSeguimientos) {
      this.cargarSeguimientos(this.offsetSeguimientos + this.limitSeguimientos);
    }
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
