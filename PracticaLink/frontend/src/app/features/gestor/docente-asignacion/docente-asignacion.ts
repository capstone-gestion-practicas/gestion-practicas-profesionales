import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { IonButton, IonInput, IonItem, IonLabel, IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { AsignacionDocenteDetalle, DocenteService } from '../../docente/docente.service';

/** Errores de carga definitivos (sesión, permiso, inexistencia, estado): reintentar no cambia el resultado. */
const ERRORES_CARGA_SIN_REINTENTO = [401, 403, 404, 409];

/** Mensaje claro y sin datos técnicos para un fallo al consultar la asignación. */
function mensajeErrorCarga(status: number): string {
  switch (status) {
    case 401: return 'Tu sesión no es válida. Inicia sesión nuevamente.';
    case 403: return 'Solo el GESTOR responsable puede gestionar esta asignación.';
    case 404: return 'No se encontró la práctica.';
    case 409: return 'El estado actual no permite asignar docentes.';
    default: return 'No fue posible consultar la asignación.';
  }
}

@Component({ selector: 'app-docente-asignacion', standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonInput, IonItem, IonLabel, IonSpinner],
  templateUrl: './docente-asignacion.html', styleUrl: './docente-asignacion.scss' })
export class DocenteAsignacion implements OnInit, OnDestroy {
  @Input({ required: true }) idPractica!: number;
  idDocente = '';
  asignacion: AsignacionDocenteDetalle | null = null;
  cargando = true;
  motivo = '';
  enviando = false;
  mensaje = '';
  /** Error de carga (sin asignación) o de guardado (con asignación); la plantilla muestra uno solo. */
  error = '';
  /** Solo errores transitorios de carga (red o servidor) admiten reintento manual. */
  puedeReintentarCarga = false;
  resultadoActualizado = false;
  private consultaCarga?: Subscription;
  constructor(private readonly api: DocenteService) {}

  ngOnInit(): void {
    this.cargar();
  }

  ngOnDestroy(): void {
    this.consultaCarga?.unsubscribe();
  }

  /** Consulta inicial y reintento manual; ignora llamadas mientras otra carga sigue en curso. */
  cargar(): void {
    if (this.consultaCarga && !this.consultaCarga.closed) return;
    this.cargando = true;
    this.error = '';
    this.puedeReintentarCarga = false;
    this.consultaCarga = this.api.consultarAsignacion(this.idPractica).subscribe({
      next: asignacion => { this.asignacion = asignacion; this.idDocente = ''; this.cargando = false; },
      error: (error: HttpErrorResponse) => {
        this.cargando = false;
        this.error = mensajeErrorCarga(error.status);
        this.puedeReintentarCarga = !ERRORES_CARGA_SIN_REINTENTO.includes(error.status);
      }
    });
  }

  guardar(): void {
    this.error = ''; this.mensaje = '';
    if (!this.idDocente) { this.error = 'Selecciona un docente o la opción de retiro.'; return; }
    const id = this.idDocente === '__RETIRAR__' ? null : Number(this.idDocente);
    if (id !== null && (!Number.isSafeInteger(id) || id < 1)) {
      this.error = 'Ingresa un identificador de usuario válido.'; return;
    }
    this.enviando = true;
    this.api.asignar(this.idPractica, id, this.motivo.trim() || null).subscribe({
      next: resultado => {
        this.enviando = false; this.resultadoActualizado = true;
        this.mensaje = resultado.id_docente === null
          ? 'Asignación docente retirada.' : `Docente ${resultado.id_docente} asignado.`;
        this.idDocente = ''; this.motivo = '';
        this.api.consultarAsignacion(this.idPractica).subscribe({ next: asignacion => this.asignacion = asignacion });
      },
      error: (error: HttpErrorResponse) => {
        this.enviando = false;
        this.error = error.status === 403 ? 'Solo el GESTOR responsable puede modificar esta asignación.'
          : error.status === 404 ? 'No se encontró la práctica.'
          : error.status === 422 ? 'El motivo es obligatorio para reemplazar o retirar una asignación.'
          : error.status === 409 ? (error.error?.detail ?? 'La asignación no está permitida en el estado actual.')
          : 'No fue posible guardar la asignación. Intenta nuevamente.';
      }
    });
  }
}
