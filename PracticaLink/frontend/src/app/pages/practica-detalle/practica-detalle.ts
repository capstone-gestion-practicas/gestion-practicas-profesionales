import { InformeFinal } from '../../features/informe-final/informe-final';
import { SesionService } from '../../core/session/sesion.service';
import { muestraEspacioGestor } from '../../core/navigation/espacio-gestor';
import { filtrosRetornoPracticas } from '../../core/navigation/retorno-practicas';
import { IncidenciaEstado } from './incidencia-estado';
import { IncidenciaHistorialItem } from '../../core/models/incidencia.models';
import { SeguimientoHistorialItem } from '../../core/models/seguimiento.models';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonContent, IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';
import {
  CerrarPracticaResponse,
  EventoHistorial,
  PracticaDetalleGestionResponse
} from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';

import { AuthStore } from '../../core/store/auth.store';
import { CierrePractica } from '../../features/gestor/cierre-practica/cierre-practica';
import { fechaTerminoCumplida } from '../../features/gestor/cierre-practica/cierre-reglas';
import { DocenteAsignacion } from '../../features/gestor/docente-asignacion/docente-asignacion';
import { formatearFechaCalendario, formatearFechaHoraChile } from '../../core/utils/fechas';

@Component({
  selector: 'app-practica-detalle', standalone: true,
  imports: [
    CommonModule, FormsModule, IonButton, IonContent, IonSpinner, IncidenciaEstado, DocenteAsignacion, InformeFinal,
    CierrePractica
  ],
  templateUrl: './practica-detalle.html', styleUrl: './practica-detalle.scss'
})
export class PracticaDetalle implements OnInit, OnDestroy {
  detalle: PracticaDetalleGestionResponse | null = null;
  cargando = false;
  error = '';
  permiteReintentar = false;
  eventos: EventoHistorial[] = [];
  incidenciaSeleccionada: IncidenciaHistorialItem | null = null;
  gestionPendiente = false;
  mensajeGestion = '';
  registrosIncidencia: IncidenciaHistorialItem[] = [];
  readonly limitIncidencias = 50;
  offsetIncidencias = 0;
  hayMasIncidencias = false;
  cargandoIncidencias = false;
  incidenciasConsultadas = false;
  errorIncidencias = '';
  private consultaIncidencias?: Subscription;
  registrosSeguimiento: SeguimientoHistorialItem[] = [];
  readonly limitSeguimientos = 50;
  offsetSeguimientos = 0;
  hayMasSeguimientos = false;
  cargandoSeguimientos = false;
  seguimientosConsultados = false;
  errorSeguimientos = '';
  private consultaSeguimientos?: Subscription;
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
  /** Confirmación del cierre académico; persiste tras recargar el detalle de la misma práctica. */
  mensajeCierre = '';
  private operacionInicio?: Subscription;
  private consultaHistorial?: Subscription;
  idPractica = '';
  private consulta?: Subscription;
  private parametros?: Subscription;
  readonly formatearFechaHora = formatearFechaHoraChile;
  readonly formatearFecha = formatearFechaCalendario;

  get puedeAsignarDocente(): boolean {
    const roles = this.auth.contexto()?.roles ?? [];
    return roles.includes('GESTOR') && sessionStorage.getItem('practicalink-workspace') !== 'ADMINISTRADOR';
  }

  /**
   * Asignación DOCENTE (etapa 3e): mismas restricciones de rol y espacio que antes
   * (puedeAsignarDocente) y solo en APROBADA o EN_CURSO, los estados en que el servidor la
   * admite (ESTADO_NO_PERMITIDO en los demás). Es visibilidad: el servidor sigue autorizando.
   */
  get muestraAsignacionDocente(): boolean {
    const estado = this.detalle?.estado.nombre;
    return this.puedeAsignarDocente && (estado === 'APROBADA' || estado === 'EN_CURSO');
  }

  /**
   * Espacio GESTOR efectivo (misma regla que GestorLayout): oculta la barra propia del detalle,
   * que la cabecera persistente sustituye. Getter, como puedeAsignarDocente, porque la elección
   * de espacio vive en sessionStorage y no es una señal.
   */
  get espacioGestor(): boolean {
    return muestraEspacioGestor(this.auth.contexto());
  }

  /**
   * Visibilidad del cierre académico (etapa 3d): detalle cargado, rol GESTOR, espacio GESTOR,
   * EN_CURSO no final y término cumplido (fechaTerminoCumplida, misma regla que GestionEstados).
   * El detalle no expone id_gestor: no se infiere responsabilidad aquí; la consulta académica y
   * el cierre la exigen en el servidor. Con 401/403/404 detalle es null y no se muestra.
   */
  get puedeCerrar(): boolean {
    const practica = this.detalle;
    const roles = this.auth.contexto()?.roles ?? [];
    return practica !== null && roles.includes('GESTOR') && this.espacioGestor
      && practica.estado.nombre === 'EN_CURSO' && !practica.estado.es_final
      && fechaTerminoCumplida(practica.fecha_termino);
  }

  /**
   * Cierre confirmado por el backend: conserva el mensaje (el componente de cierre desaparece
   * al pasar a FINALIZADA) y recarga detalle y antecedentes. Ignora confirmaciones de otra práctica.
   */
  alCerrarPractica(respuesta: CerrarPracticaResponse): void {
    if (String(respuesta.id_practica) !== this.idPractica) return;
    this.mensajeCierre = respuesta.mensaje;
    this.consultarEstado();
  }

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
    private readonly sesion: SesionService,
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
      this.mensajeCierre = '';
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
      this.incidenciaSeleccionada = null;
      this.gestionPendiente = false;
      this.mensajeGestion = '';
      this.consultaIncidencias?.unsubscribe();
      this.registrosIncidencia = [];
      this.offsetIncidencias = 0;
      this.hayMasIncidencias = false;
      this.cargandoIncidencias = false;
      this.incidenciasConsultadas = false;
      this.errorIncidencias = '';
      this.idPractica = parametros.get('id') ?? '';
      this.vistaHistorial = 'seguimientos';
      this.cargar();
      this.historialHabilitado = this.idValido();
      if (this.historialHabilitado) {
        this.cargarHistorial(0);
        this.cargarSeguimientos(0);
        if (this.route.snapshot?.queryParamMap?.get('vista') === 'incidencias') {
          this.seleccionarVista('incidencias');
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.consultaIncidencias?.unsubscribe();
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

  /** Los seguimientos solo se registran con la práctica EN_CURSO (la API y la BD también lo exigen). */
  get puedeRegistrarSeguimiento(): boolean {
    return this.detalle?.estado.nombre === 'EN_CURSO';
  }

  /** Las incidencias también exigen EN_CURSO. */
  get puedeRegistrarIncidencia(): boolean {
    return this.detalle?.estado.nombre === 'EN_CURSO';
  }

  registrarSeguimiento(): void {
    this.router.navigate(['/practicas', this.idPractica, 'seguimiento', 'nuevo']);
  }

  registrarIncidencia(): void {
    this.router.navigate(['/practicas', this.idPractica, 'incidencias', 'nueva']);
  }

  seleccionarVista(vista: 'seguimientos' | 'incidencias' | 'antecedentes'): void {
    this.vistaHistorial = vista;
    if (vista === 'incidencias' && !this.incidenciasConsultadas && !this.errorIncidencias) {
      this.cargarIncidencias();
    }
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
          this.sesion.cerrar();
        }
      }
    });
  }

  get puedeConsultarIncidencias(): boolean {
    return (this.auth.contexto()?.roles ?? [])
      .some(rol => rol === 'GESTOR' || rol === 'ADMINISTRADOR');
  }

  formatearFechaIncidencia(fecha: string): string {
    return Number.isFinite(Date.parse(fecha)) ? formatearFechaHoraChile(fecha) : fecha;
  }

  cargarIncidencias(offset = this.offsetIncidencias): void {
    if (!this.idValido() || this.cargandoIncidencias || this.gestionPendiente) return;
    if (!this.puedeConsultarIncidencias) {
      this.errorIncidencias = 'Acceso denegado al historial de incidencias.';
      return;
    }
    this.incidenciaSeleccionada = null;
    this.consultaIncidencias?.unsubscribe();
    this.offsetIncidencias = offset;
    this.registrosIncidencia = [];
    this.hayMasIncidencias = false;
    this.incidenciasConsultadas = false;
    this.errorIncidencias = '';
    this.cargandoIncidencias = true;
    this.consultaIncidencias = this.practicas.obtenerIncidencias(
      this.idPractica, this.limitIncidencias, offset
    ).subscribe({
      next: historial => {
        this.registrosIncidencia = historial.items;
        this.hayMasIncidencias = historial.hay_mas;
        this.cargandoIncidencias = false;
        this.incidenciasConsultadas = true;
      },
      error: (error: HttpErrorResponse) => {
        this.cargandoIncidencias = false;
        const mensajes: Record<number, string> = {
          401: 'Tu sesión no es válida. Inicia sesión nuevamente.',
          403: 'Acceso denegado al historial de incidencias.',
          404: 'La práctica no está disponible.',
          422: 'Los parámetros de consulta no son válidos.',
          500: 'El servidor no pudo consultar las incidencias.',
          503: 'El servicio de incidencias está temporalmente no disponible.'
        };
        this.errorIncidencias = mensajes[error.status]
          ?? 'No fue posible conectar para consultar las incidencias.';
        if (error.status === 401) {
          this.sesion.cerrar();
        }
      }
    });
  }

  seleccionarIncidencia(incidencia: IncidenciaHistorialItem): void {
    if (!this.puedeConsultarIncidencias || this.gestionPendiente) return;
    this.mensajeGestion = '';
    this.incidenciaSeleccionada = incidencia;
  }

  actualizarIncidencias(mensaje: string): void {
    this.gestionPendiente = false;
    this.mensajeGestion = mensaje;
    this.cargarIncidencias();
  }

  anteriorIncidencias(): void {
    if (!this.cargandoIncidencias && this.offsetIncidencias > 0) {
      this.cargarIncidencias(Math.max(0, this.offsetIncidencias - this.limitIncidencias));
    }
  }

  siguienteIncidencias(): void {
    if (!this.cargandoIncidencias && this.hayMasIncidencias) {
      this.cargarIncidencias(this.offsetIncidencias + this.limitIncidencias);
    }
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

  volver(): void {
    const filtros = filtrosRetornoPracticas(this.route.snapshot?.queryParamMap);
    if (filtros && Object.keys(filtros).length > 0) {
      void this.router.navigate(['/practicas'], { queryParams: filtros });
    } else {
      void this.router.navigate(['/practicas']);
    }
  }
}
