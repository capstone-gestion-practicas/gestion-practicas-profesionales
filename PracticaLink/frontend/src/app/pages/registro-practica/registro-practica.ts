import { SesionService } from '../../core/session/sesion.service';
import { formatearFechaHoraChile } from '../../core/utils/fechas';
import { fechaSeguimientoValida, hoySantiago, MEDIOS_CONTACTO, SeguimientoCreate } from '../../core/models/seguimiento.models';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonContent, IonSpinner } from '@ionic/angular';
import { finalize, Subscription } from 'rxjs';
import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { IncidenciaCreate, TIPOS_INCIDENCIA } from '../../core/models/incidencia.models';
import { AuthStore } from '../../core/store/auth.store';

@Component({
  selector: 'app-registro-practica',
  standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonContent, IonSpinner],
  templateUrl: './registro-practica.html',
  styleUrl: './registro-practica.scss'
})
export class RegistroPractica implements OnInit, OnDestroy {
  detalle: PracticaDetalleGestionResponse | null = null;
  tipo: 'seguimiento' | 'incidencia' = 'seguimiento';
  idPractica = '';
  fecha = hoySantiago();
  tipoContacto = '';
  observaciones = '';
  seguimientoBloqueado = false;
  private envio?: Subscription;
  readonly tiposIncidencia = TIPOS_INCIDENCIA;
  tipoIncidencia = '';
  incidenciaBloqueada = false;
  fechaIncidencia = '';
  readonly fechaIncidenciaVisible = formatearFechaHoraChile;
  descripcionIncidencia = '';
  cargando = true;
  guardando = false;
  error = '';
  mensaje = '';
  private consulta?: Subscription;
  private parametros?: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly sesion: SesionService,
    private readonly practicas: PracticaService,
    private readonly authStore: AuthStore
  ) {}

  ngOnInit(): void {
    this.parametros = this.route.paramMap.subscribe(parametros => {
      this.cargarFormulario(parametros.get('id') ?? '');
    });
  }

  private cargarFormulario(idPractica: string): void {
    this.consulta?.unsubscribe();
    this.envio?.unsubscribe();
    this.detalle = null;
    this.cargando = true;
    this.guardando = false;
    this.error = '';
    this.mensaje = '';
    this.tipoContacto = '';
    this.observaciones = '';
    this.seguimientoBloqueado = false;
    this.tipoIncidencia = '';
    this.incidenciaBloqueada = false;
    this.fechaIncidencia = '';
    this.descripcionIncidencia = '';
    this.tipo = this.route.snapshot.data['tipoRegistro'] === 'incidencia'
      ? 'incidencia'
      : 'seguimiento';
    this.fecha = this.esIncidencia ? '' : hoySantiago();
    this.idPractica = idPractica;
    if (!this.idValido()) {
      this.error = 'El identificador de práctica no es válido.';
      this.cargando = false;
      return;
    }
    this.consulta = this.practicas.obtenerDetalle(this.idPractica).subscribe({
      next: detalle => {
        this.detalle = detalle;
        this.cargando = false;
      },
      error: (error: HttpErrorResponse) => {
        this.cargando = false;
        this.error = error.status === 404
          ? 'La práctica no existe.'
          : error.status === 401 || error.status === 403
            ? 'Acceso denegado. Revisa tu sesión y permisos.'
            : 'No fue posible cargar la práctica. Intenta nuevamente.';
      }
    });
  }

  ngOnDestroy(): void {
    this.parametros?.unsubscribe();
    this.consulta?.unsubscribe();
    this.envio?.unsubscribe();
  }

  get esIncidencia(): boolean {
    return this.tipo === 'incidencia';
  }

  cancelar(): void {
    if (this.esIncidencia && this.fechaIncidencia) {
      this.router.navigate(['/practicas', this.idPractica], { queryParams: { vista: 'incidencias' } });
      return;
    }
    this.router.navigate(['/practicas', this.idPractica]);
  }

  navegarA(ruta: string): void {
    this.router.navigate([ruta]);
  }

  guardar(): void {
    if (!this.detalle || this.guardando || (!this.esIncidencia && this.seguimientoBloqueado)) return;
    if (this.esIncidencia) {
      this.guardarIncidencia();
      return;
    }
    if (!this.fecha || !this.observaciones.trim() || !this.tipoContacto) {
      this.error = 'Completa los campos obligatorios antes de guardar.';
      return;
    }
    this.guardarSeguimiento();
  }

  get incidenciaHabilitada(): boolean {
    return this.detalle?.estado.nombre === 'EN_CURSO' && !this.detalle.estado.es_final;
  }

  private guardarIncidencia(): void {
    if (this.incidenciaBloqueada) return;
    if (!this.incidenciaHabilitada) {
      this.error = 'Solo se pueden registrar incidencias en prácticas EN_CURSO.';
      return;
    }
    if (!TIPOS_INCIDENCIA.some(tipo => tipo.codigo === this.tipoIncidencia)
        || !this.descripcionIncidencia.trim() || Array.from(this.descripcionIncidencia).length > 2000) {
      this.error = 'Selecciona un tipo válido y escribe una descripción con contenido de hasta 2.000 caracteres.';
      return;
    }
    this.guardando = true;
    this.error = '';
    this.mensaje = '';
    const datos: IncidenciaCreate = {
      tipo: this.tipoIncidencia as IncidenciaCreate['tipo'], descripcion: this.descripcionIncidencia
    };
    const practica = this.idPractica;
    this.envio = this.practicas.registrarIncidencia(practica, datos)
      .pipe(finalize(() => { this.guardando = false; }))
      .subscribe({
        next: respuesta => {
          this.incidenciaBloqueada = true;
          const registro = respuesta.body;
          if (respuesta.status === 201 && registro && String(registro.id_practica) === practica
              && registro.estado === 'PENDIENTE' && registro.tipo === datos.tipo
              && registro.descripcion === datos.descripcion
              && /(?:Z|[+-]\d{2}:\d{2})$/.test(registro.fecha)
              && Number.isFinite(Date.parse(registro.fecha))) {
            this.fechaIncidencia = registro.fecha;
            this.mensaje = 'Incidencia registrada correctamente en el servidor. Estado inicial: PENDIENTE.';
          } else {
            this.error = 'No se pudo confirmar el registro. No repitas el envío; solicita verificar el resultado.';
          }
        },
        error: (error: HttpErrorResponse) => {
          const mensajes: Record<number, string> = {
            401: 'Tu sesión no es válida o expiró. Inicia sesión nuevamente.',
            403: 'No tienes permisos para registrar incidencias.',
            404: 'La práctica no existe.',
            409: 'La práctica no está en curso o hubo un conflicto concurrente. Revisa su estado.',
            422: 'Los datos no son válidos. Revisa el tipo y la descripción.',
            500: 'El servidor no pudo confirmar el registro.',
            503: 'El servicio no está disponible y no se pudo confirmar el registro.'
          };
          this.error = mensajes[error.status] ?? 'No se pudo confirmar el registro por un error de conexión o del servidor.';
          this.incidenciaBloqueada = ![401, 403, 404, 409, 422].includes(error.status);
          if (this.incidenciaBloqueada) {
            this.error += ' No repitas el envío; solicita verificar el resultado antes de registrar nuevamente.';
          }
          if (error.status === 401) {
            this.sesion.cerrar();
          }
        }
      });
  }

  get fechaMaxima(): string { return hoySantiago(); }

  private guardarSeguimiento(): void {
    if (!fechaSeguimientoValida(this.fecha)) {
      this.error = 'Ingresa una fecha válida, no futura en America/Santiago.';
      return;
    }
    if (!MEDIOS_CONTACTO.some(medio => medio === this.tipoContacto)
        || Array.from(this.observaciones).length > 2000) {
      this.error = 'Selecciona un medio válido y escribe hasta 2.000 caracteres de observación.';
      return;
    }
    this.guardando = true;
    this.error = '';
    this.mensaje = '';
    const datos: SeguimientoCreate = {
      fecha: this.fecha, tipo: this.tipoContacto as SeguimientoCreate['tipo'],
      observacion: this.observaciones
    };
    this.envio = this.practicas.registrarSeguimiento(this.idPractica, datos)
      .pipe(finalize(() => { this.guardando = false; }))
      .subscribe({
        next: respuesta => {
          this.seguimientoBloqueado = true;
          if (respuesta.status === 201 && respuesta.body) {
            this.mensaje = 'Seguimiento registrado correctamente en el servidor. Puedes consultarlo al volver al detalle de la práctica.';
          } else {
            this.error = 'No se pudo confirmar el registro. No repitas el envío; solicita verificar el resultado.';
          }
        },
        error: (error: HttpErrorResponse) => {
          const mensajes: Record<number, string> = {
            401: 'Tu sesión no es válida o expiró. Inicia sesión nuevamente.',
            403: 'No tienes permisos para registrar seguimientos.',
            404: 'La práctica no existe.',
            409: 'La práctica no está en curso o hubo un conflicto concurrente. Revisa su estado.',
            422: 'Los datos no son válidos. Revisa la fecha, el medio y las observaciones.',
            500: 'El servidor no pudo confirmar el registro.',
            503: 'El servicio no está disponible y no se pudo confirmar el registro.'
          };
          this.error = mensajes[error.status] ?? 'No se pudo confirmar el registro por un error de conexión o del servidor.';
          this.seguimientoBloqueado = ![401, 403, 404, 409, 422].includes(error.status);
          if (this.seguimientoBloqueado) {
            this.error += ' No repitas el envío; solicita verificar el resultado antes de registrar nuevamente.';
          }
        }
      });
  }

  private idValido(): boolean {
    return /^[1-9][0-9]{0,18}$/.test(this.idPractica)
      && BigInt(this.idPractica) <= 9223372036854775807n;
  }

}
