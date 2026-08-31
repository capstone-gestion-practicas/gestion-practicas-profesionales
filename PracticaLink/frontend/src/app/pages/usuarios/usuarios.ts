import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton, IonCard, IonCardContent, IonCheckbox, IonContent, IonInput,
  IonItem, IonLabel, IonModal, IonSpinner, IonToggle
} from '@ionic/angular';
import { forkJoin } from 'rxjs';

import { Rol, UsuarioAdministrable } from '../../core/models/usuario.models';
import { UsuarioService } from '../../core/services/usuario.service';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [
    CommonModule, FormsModule, IonButton, IonCard, IonCardContent, IonCheckbox,
    IonContent, IonInput, IonItem, IonLabel, IonModal, IonSpinner, IonToggle
  ],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.scss'
})
export class Usuarios implements OnInit {
  private readonly usuarioService = inject(UsuarioService);
  private readonly router = inject(Router);

  usuarios: UsuarioAdministrable[] = [];
  roles: Rol[] = [];
  cargando = true;
  error = '';
  modalAbierto = false;
  guardando = false;
  usuarioEditando: UsuarioAdministrable | null = null;
  nombre = '';
  apellido = '';
  correo = '';
  password = '';
  activo = true;
  rolesSeleccionados: string[] = [];
  errorModal = '';

  ngOnInit(): void { this.cargar(); }

  cargar(): void {
    this.cargando = true;
    this.error = '';
    forkJoin({
      usuarios: this.usuarioService.listar(),
      roles: this.usuarioService.listarRoles()
    }).subscribe({
      next: ({ usuarios, roles }) => {
        this.usuarios = usuarios;
        this.roles = roles;
        this.cargando = false;
      },
      error: () => {
        this.error = 'No fue posible cargar la gestión de usuarios.';
        this.cargando = false;
      }
    });
  }

  abrirCrear(): void {
    this.usuarioEditando = null;
    this.nombre = '';
    this.apellido = '';
    this.correo = '';
    this.password = '';
    this.activo = true;
    this.rolesSeleccionados = [];
    this.errorModal = '';
    this.modalAbierto = true;
  }

  abrirEditar(usuario: UsuarioAdministrable): void {
    this.usuarioEditando = usuario;
    this.nombre = usuario.nombre;
    this.apellido = usuario.apellido;
    this.correo = usuario.correo;
    this.password = '';
    this.activo = usuario.activo;
    this.rolesSeleccionados = [...usuario.roles];
    this.errorModal = '';
    this.modalAbierto = true;
  }

  alternarRol(rol: string, seleccionado: boolean): void {
    this.rolesSeleccionados = seleccionado
      ? [...new Set([...this.rolesSeleccionados, rol])]
      : this.rolesSeleccionados.filter(actual => actual !== rol);
  }

  tieneRol(rol: string): boolean { return this.rolesSeleccionados.includes(rol); }

  cerrarModal(): void {
    if (!this.guardando) this.modalAbierto = false;
  }

  guardar(): void {
    if (!this.nombre.trim() || !this.apellido.trim() || this.rolesSeleccionados.length === 0) {
      this.errorModal = 'Nombre, apellido y al menos un rol son obligatorios.';
      return;
    }
    if (!this.usuarioEditando && (!this.correo.trim() || this.password.length < 8)) {
      this.errorModal = 'Ingresa un correo y una contraseña de al menos 8 caracteres.';
      return;
    }

    this.guardando = true;
    this.errorModal = '';
    const solicitud = this.usuarioEditando
      ? this.usuarioService.actualizar(this.usuarioEditando.id_usuario, {
          nombre: this.nombre.trim(), apellido: this.apellido.trim(),
          activo: this.activo, roles: this.rolesSeleccionados
        })
      : this.usuarioService.crear({
          nombre: this.nombre.trim(), apellido: this.apellido.trim(),
          correo: this.correo.trim(), password: this.password,
          roles: this.rolesSeleccionados
        });

    solicitud.subscribe({
      next: () => {
        this.guardando = false;
        this.modalAbierto = false;
        this.cargar();
      },
      error: (error: HttpErrorResponse) => {
        this.guardando = false;
        this.errorModal = typeof error.error?.detail === 'string'
          ? error.error.detail : 'No fue posible guardar el usuario.';
      }
    });
  }

  volver(): void { this.router.navigate(['/home']); }
}
