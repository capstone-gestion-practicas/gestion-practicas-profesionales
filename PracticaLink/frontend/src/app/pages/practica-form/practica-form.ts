import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonSpinner,
  IonTextarea
} from '@ionic/angular';
import { switchMap } from 'rxjs';

import { PracticaCreate } from '../../core/models/practica.models';
import { AuthService } from '../../core/services/auth.service';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';

@Component({
  selector: 'app-practica-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonItem,
    IonLabel,
    IonInput,
    IonTextarea,
    IonButton,
    IonSpinner
  ],
  templateUrl: './practica-form.html',
  styleUrl: './practica-form.scss'
})
export class PracticaForm {
  readonly formulario;
  enviando = false;
  error = '';

  constructor(
    formBuilder: FormBuilder,
    private readonly practicaService: PracticaService,
    private readonly authService: AuthService,
    private readonly authStore: AuthStore,
    private readonly router: Router
  ) {
    this.formulario = formBuilder.nonNullable.group({
      centroNombre: ['', [Validators.required, Validators.minLength(2)]],
      rutEmpresa: [''],
      direccion: [''],
      telefono: [''],
      correo: ['', Validators.email],
      contactoNombre: [''],
      contactoCargo: [''],
      fechaInicio: [''],
      fechaTermino: [''],
      horas: ['', Validators.pattern(/^\d+$/)],
      cargoFuncion: [''],
      descripcion: ['']
    });
  }

  registrar(): void {
    this.error = '';

    if (this.formulario.invalid || !this.fechasValidas()) {
      this.formulario.markAllAsTouched();
      this.error = 'Revisa los campos obligatorios y las fechas ingresadas.';
      return;
    }

    const valor = this.formulario.getRawValue();
    const datos: PracticaCreate = {
      centro: {
        nombre: valor.centroNombre.trim(),
        rut_empresa: this.opcional(valor.rutEmpresa),
        direccion: this.opcional(valor.direccion),
        telefono: this.opcional(valor.telefono),
        correo: this.opcional(valor.correo),
        contacto_nombre: this.opcional(valor.contactoNombre),
        contacto_cargo: this.opcional(valor.contactoCargo)
      },
      fecha_inicio: this.opcional(valor.fechaInicio),
      fecha_termino: this.opcional(valor.fechaTermino),
      horas: valor.horas ? Number(valor.horas) : null,
      cargo_funcion: this.opcional(valor.cargoFuncion),
      descripcion: this.opcional(valor.descripcion)
    };

    this.enviando = true;
    this.practicaService.registrar(datos).pipe(
      switchMap(() => this.authService.obtenerContexto())
    ).subscribe({
      next: contexto => {
        this.authStore.setContexto(contexto);
        this.enviando = false;
        this.router.navigate(['/home']);
      },
      error: (error: HttpErrorResponse) => {
        this.enviando = false;
        this.error = typeof error.error?.detail === 'string'
          ? error.error.detail
          : 'No fue posible registrar la práctica.';
      }
    });
  }

  cancelar(): void {
    this.router.navigate(['/home']);
  }

  private fechasValidas(): boolean {
    const { fechaInicio, fechaTermino } = this.formulario.getRawValue();
    return !fechaInicio || !fechaTermino || fechaTermino >= fechaInicio;
  }

  private opcional(valor: string): string | null {
    const limpio = valor.trim();
    return limpio || null;
  }
}
