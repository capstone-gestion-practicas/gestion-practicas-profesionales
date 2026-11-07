import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { IonButton, IonInput, IonItem, IonLabel, IonSpinner } from '@ionic/angular';
import { AsignacionDocenteDetalle, DocenteService } from '../../docente/docente.service';

@Component({ selector: 'app-docente-asignacion', standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonInput, IonItem, IonLabel, IonSpinner],
  templateUrl: './docente-asignacion.html', styleUrl: './docente-asignacion.scss' })
export class DocenteAsignacion {
  @Input({ required: true }) idPractica!: number;
  idDocente = '';
  asignacion: AsignacionDocenteDetalle | null = null;
  cargando = true;
  motivo = '';
  enviando = false;
  mensaje = '';
  error = '';
  resultadoActualizado = false;
  constructor(private readonly api: DocenteService) {}

  ngOnInit(): void {
    this.api.consultarAsignacion(this.idPractica).subscribe({
      next: asignacion => { this.asignacion = asignacion; this.idDocente = ''; this.cargando = false; },
      error: error => { this.cargando = false; this.error = error.status === 403 ? 'Solo el GESTOR responsable puede gestionar esta asignación.' : error.status === 409 ? 'El estado actual no permite asignar docentes.' : 'No fue posible consultar la asignación.'; }
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
