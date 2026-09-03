import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
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
  IonToast,
  IonTextarea,
  ModalController
} from '@ionic/angular';
import { switchMap } from 'rxjs';

import { EmpresaLookup, PracticaCreate } from '../../core/models/practica.models';
import { AuthService } from '../../core/services/auth.service';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { formatearRut, rutValidator } from '../../core/validators/rut.validator';

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
    IonSpinner,
    IonToast
  ],
  templateUrl: './practica-form.html',
  styleUrl: './practica-form.scss'
})
export class PracticaForm {
  readonly formulario;
  enviando = false;
  consultandoEmpresa = false;
  empresaEncontrada: EmpresaLookup | null = null;
  error = '';

  get formularioListo(): boolean {
    return this.formulario.valid && this.fechasValidas() && !this.consultandoEmpresa;
  }

  get puedeBuscarEmpresa(): boolean {
    const control = this.formulario.controls.rutEmpresa;
    return !!control.value.trim() && control.valid && !this.consultandoEmpresa;
  }

  constructor(
    formBuilder: FormBuilder,
    private readonly practicaService: PracticaService,
    private readonly authService: AuthService,
    private readonly authStore: AuthStore,
    private readonly modalController: ModalController
  ) {
    this.formulario = formBuilder.nonNullable.group({
      centroNombre: ['', [Validators.required, Validators.minLength(2)]],
      rutEmpresa: ['', rutValidator],
      direccion: [''],
      telefono: [''],
      correo: ['', [Validators.email, Validators.maxLength(150)]],
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
        correo: this.correoOpcional(valor.correo),
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
        this.modalController.dismiss({ registrada: true });
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
    this.modalController.dismiss();
  }

  private fechasValidas(): boolean {
    const { fechaInicio, fechaTermino } = this.formulario.getRawValue();
    return !fechaInicio || !fechaTermino || fechaTermino >= fechaInicio;
  }

  private opcional(valor: string): string | null {
    const limpio = valor.trim();
    return limpio || null;
  }

  validarCorreo(): void {
    const control = this.formulario.controls.correo;
    control.markAsTouched();
    if (control.invalid) {
      this.error = 'Ingresa un correo válido de máximo 150 caracteres.';
    }
  }

  buscarEmpresa(): void {
    const control = this.formulario.controls.rutEmpresa;
    const valor = control.value.trim();
    this.empresaEncontrada = null;
    this.error = '';

    if (!valor) {
      control.markAsTouched();
      this.error = 'Ingresa el RUT de la empresa para buscarla.';
      return;
    }

    control.setValue(formatearRut(valor));
    control.markAsTouched();
    if (control.invalid) {
      this.error = 'Ingresa un RUT de empresa válido con dígito verificador.';
      return;
    }

    this.consultandoEmpresa = true;
    this.practicaService.consultarEmpresa(control.value).subscribe({
      next: empresa => {
        this.empresaEncontrada = empresa;
        this.formulario.controls.centroNombre.setValue(empresa.razon_social);
        this.formulario.controls.centroNombre.markAsDirty();
        this.consultandoEmpresa = false;
      },
      error: (error: HttpErrorResponse) => {
        this.consultandoEmpresa = false;
        if (error.status === 404) {
          this.error = 'No encontramos la empresa. Puedes ingresar sus datos manualmente.';
        } else if (error.status === 503) {
          this.error = 'La consulta no está disponible. Puedes ingresar los datos manualmente.';
        } else {
          this.error = 'No fue posible consultar la empresa. Puedes continuar manualmente.';
        }
      }
    });
  }

  cambiarRutEmpresa(): void {
    this.empresaEncontrada = null;
  }

  cerrarToast(): void {
    this.error = '';
  }

  private correoOpcional(valor: string): string | null {
    const limpio = valor.trim().toLowerCase();
    return limpio || null;
  }
}
