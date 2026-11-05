import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonInput, IonItem, IonLabel, IonSpinner, ModalController
} from '@ionic/angular';

import { PerfilEstudianteCreate } from '../../../../core/models/estudiante.models';
import { formatearRut, rutValido } from '../../../../core/validators/rut.validator';
import { PerfilEstudianteWorkflowService } from '../../services/perfil-estudiante-workflow.service';

@Component({
  selector: 'app-completar-perfil-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonInput, IonItem, IonLabel, IonSpinner],
  templateUrl: './completar-perfil-modal.html',
  styleUrl: './completar-perfil-modal.scss'
})
export class CompletarPerfilModal {
  private readonly workflow = inject(PerfilEstudianteWorkflowService);
  private readonly modalController = inject(ModalController);

  rut = '';
  carrera = '';
  sede = '';
  telefono = '';
  direccion = '';
  guardando = false;
  error = '';

  guardar(): void {
    if (!this.rut.trim() || !this.carrera.trim() || !this.sede.trim()) {
      this.error = 'RUT, carrera y sede son obligatorios.';
      return;
    }
    if (!rutValido(this.rut)) {
      this.error = 'Ingresa un RUT válido con dígito verificador.';
      return;
    }

    this.rut = formatearRut(this.rut);
    const datos: PerfilEstudianteCreate = {
      rut: this.rut.trim(),
      carrera: this.carrera.trim(),
      sede: this.sede.trim(),
      telefono: this.opcional(this.telefono),
      direccion: this.opcional(this.direccion)
    };
    this.error = '';
    this.guardando = true;
    this.workflow.completar(datos).subscribe({
      next: () => {
        this.guardando = false;
        void this.modalController.dismiss({ completado: true });
      },
      error: (error: HttpErrorResponse) => {
        this.guardando = false;
        this.error = typeof error.error?.detail === 'string'
          ? error.error.detail
          : 'No fue posible completar el perfil.';
      }
    });
  }

  cerrar(): void {
    if (!this.guardando) void this.modalController.dismiss();
  }

  private opcional(valor: string): string | null {
    return valor.trim() || null;
  }
}
