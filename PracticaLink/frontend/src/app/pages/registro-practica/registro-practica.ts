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
import {
  EstadoIncidencia,
  RegistroPracticaLocal,
  RegistroPracticaService,
  TipoRegistroPractica
} from '../../core/services/registro-practica.service';

@Component({
  selector: 'app-registro-practica',
  standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonContent, IonSpinner],
  templateUrl: './registro-practica.html',
  styleUrl: './registro-practica.scss'
})
export class RegistroPractica implements OnInit, OnDestroy {
  detalle: PracticaDetalleGestionResponse | null = null;
  tipo: TipoRegistroPractica = 'seguimiento';
  idPractica = '';
  fecha = this.fechaLocalHoy();
  tipoContacto = '';
  observaciones = '';
  seguimientoBloqueado = false;
  private envio?: Subscription;
  estadoIncidencia: EstadoIncidencia = 'Pendiente';
  descripcionIncidencia = '';
  incidencias: RegistroPracticaLocal[] = [];
  cargando = true;
  guardando = false;
  error = '';
  mensaje = '';
  private consulta?: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly practicas: PracticaService,
    private readonly registros: RegistroPracticaService
  ) {}

  ngOnInit(): void {
    this.tipo = this.route.snapshot.data['tipoRegistro'] === 'incidencia'
      ? 'incidencia'
      : 'seguimiento';
    if (!this.esIncidencia) this.fecha = hoySantiago();
    this.idPractica = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.idValido()) {
      this.error = 'El identificador de práctica no es válido.';
      this.cargando = false;
      return;
    }
    this.incidencias = this.registros.listar(this.idPractica)
      .filter(registro => registro.tipo === 'incidencia');
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
    this.consulta?.unsubscribe();
    this.envio?.unsubscribe();
  }

  get esIncidencia(): boolean {
    return this.tipo === 'incidencia';
  }

  cancelar(): void {
    this.router.navigate(['/practicas', this.idPractica]);
  }

  navegarA(ruta: string): void {
    this.router.navigate([ruta]);
  }

  guardar(): void {
    if (!this.detalle || this.guardando || (!this.esIncidencia && this.seguimientoBloqueado)) return;
    const texto = this.esIncidencia ? this.descripcionIncidencia : this.observaciones;
    if (!this.fecha || !texto.trim() || (!this.esIncidencia && !this.tipoContacto)) {
      this.error = 'Completa los campos obligatorios antes de guardar.';
      return;
    }

    if (!this.esIncidencia) {
      this.guardarSeguimiento();
      return;
    }

    this.guardando = true;
    this.error = '';
    try {
      this.registros.guardar({
        id_practica: this.idPractica,
        tipo: 'incidencia',
        fecha: this.fecha,
        estado: this.estadoIncidencia,
        descripcion: this.descripcionIncidencia.trim()
      });
      this.router.navigate(['/practicas', this.idPractica]);
    } catch (error) {
      this.error = error instanceof Error
        ? error.message
        : 'No se pudo guardar el registro.';
      this.guardando = false;
    }
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

  private fechaLocalHoy(): string {
    const hoy = new Date();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const dia = String(hoy.getDate()).padStart(2, '0');
    return `${hoy.getFullYear()}-${mes}-${dia}`;
  }
}