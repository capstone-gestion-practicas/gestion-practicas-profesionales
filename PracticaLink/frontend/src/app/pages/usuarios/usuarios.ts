import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton, IonCard, IonCardContent, IonCheckbox, IonContent, IonInput,
  IonItem, IonLabel, IonModal, IonSpinner, IonToggle, IonGrid, IonRow, IonCol,
  IonTextarea, IonToast
} from '@ionic/angular';
import { forkJoin } from 'rxjs';

import {
  SolicitudCuentaEmpresa,
  SolicitudCuentaEmpresaResuelta
} from '../../core/models/laboral.models';
import { Rol, UsuarioAdministrable } from '../../core/models/usuario.models';
import { LaboralService } from '../../core/services/laboral.service';
import { UsuarioService } from '../../core/services/usuario.service';
import { MENSAJE_RUT_INVALIDO } from '../../core/utils/mensajes-rut';
import { formatearRut, rutValido } from '../../core/validators/rut.validator';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [
    CommonModule, FormsModule, IonButton, IonCard, IonCardContent, IonCheckbox,
    IonContent, IonInput, IonItem, IonLabel, IonModal, IonSpinner, IonToggle,
    IonGrid, IonRow, IonCol, IonTextarea, IonToast
  ],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.scss'
})
export class Usuarios implements OnInit {
  private readonly usuarioService = inject(UsuarioService);
  private readonly laboralService = inject(LaboralService);
  private readonly router = inject(Router);

  usuarios: UsuarioAdministrable[] = [];
  solicitudesEmpresa: SolicitudCuentaEmpresa[] = [];
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
  rutEmpresa = '';
  errorModal = '';
  mensaje = '';
  solicitudRevision: SolicitudCuentaEmpresa | null = null;
  estadoRevision: 'APROBADA' | 'RECHAZADA' = 'APROBADA';
  observacionRevision = '';
  guardandoRevision = false;
  errorRevision = '';
  toastRutAbierto = false;
  mensajeToastRut = '';

  ngOnInit(): void { this.cargar(); }

  cargar(): void {
    this.cargando = true;
    this.error = '';
    forkJoin({
      usuarios: this.usuarioService.listar(),
      roles: this.usuarioService.listarRoles(),
      solicitudes: this.laboralService.listarSolicitudesEmpresa()
    }).subscribe({
      next: ({ usuarios, roles, solicitudes }) => {
        this.usuarios = usuarios;
        this.roles = roles;
        this.solicitudesEmpresa = solicitudes;
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
    this.rutEmpresa = '';
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
    this.rutEmpresa = usuario.rut_empresa ?? '';
    this.errorModal = '';
    this.modalAbierto = true;
  }

  alternarRol(rol: string, seleccionado: boolean): void {
    if (seleccionado && rol === 'EMPRESA') {
      this.rolesSeleccionados = ['EMPRESA'];
    } else if (seleccionado) {
      this.rolesSeleccionados = [...new Set([
        ...this.rolesSeleccionados.filter(actual => actual !== 'EMPRESA'),
        rol
      ])];
    } else {
      this.rolesSeleccionados = this.rolesSeleccionados.filter(actual => actual !== rol);
    }
  }

  tieneRol(rol: string): boolean { return this.rolesSeleccionados.includes(rol); }
  get esCuentaEmpresa(): boolean { return this.tieneRol('EMPRESA'); }
  get rutEmpresaValido(): boolean { return rutValido(this.rutEmpresa); }
  actualizarRutEmpresa(rut: string): void {
    this.rutEmpresa = formatearRut(rut);
    this.toastRutAbierto = false;
  }
  validarRutEmpresa(): void {
    if (this.esCuentaEmpresa && !this.rutEmpresaValido) {
      this.mostrarToastRut(MENSAJE_RUT_INVALIDO);
    }
  }
  cerrarToastRut(): void { this.toastRutAbierto = false; }
  get solicitudesPendientes(): number {
    return this.solicitudesEmpresa.filter(solicitud => solicitud.estado === 'PENDIENTE').length;
  }

  cerrarModal(): void {
    if (!this.guardando) this.modalAbierto = false;
  }

  abrirRevision(
    solicitud: SolicitudCuentaEmpresa,
    estado: 'APROBADA' | 'RECHAZADA'
  ): void {
    this.solicitudRevision = solicitud;
    this.estadoRevision = estado;
    this.observacionRevision = '';
    this.errorRevision = '';
  }

  cerrarRevision(): void {
    if (!this.guardandoRevision) this.solicitudRevision = null;
  }

  confirmarRevision(): void {
    if (!this.solicitudRevision || this.guardandoRevision) return;
    this.guardandoRevision = true;
    this.errorRevision = '';
    this.laboralService.resolverSolicitudEmpresa(this.solicitudRevision.id_solicitud, {
      estado: this.estadoRevision,
      observacion: this.observacionRevision.trim() || null
    }).subscribe({
      next: (resultado: SolicitudCuentaEmpresaResuelta) => {
        this.guardandoRevision = false;
        this.solicitudRevision = null;
        this.mensaje = resultado.id_usuario
          ? `${resultado.mensaje}. ID de cuenta creada: ${resultado.id_usuario}.`
          : resultado.mensaje;
        this.cargar();
      },
      error: (error: HttpErrorResponse) => {
        this.guardandoRevision = false;
        this.errorRevision = typeof error.error?.detail === 'string'
          ? error.error.detail
          : 'No fue posible resolver la solicitud.';
      }
    });
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
    if (!this.usuarioEditando && !this.correoValido(this.correo)) {
      this.errorModal = 'Ingresa un correo válido de máximo 150 caracteres.';
      return;
    }
    if (this.esCuentaEmpresa && !rutValido(this.rutEmpresa)) {
      this.errorModal = MENSAJE_RUT_INVALIDO;
      this.mostrarToastRut(MENSAJE_RUT_INVALIDO);
      return;
    }

    this.guardando = true;
    this.errorModal = '';
    const solicitud = this.usuarioEditando
      ? this.usuarioService.actualizar(this.usuarioEditando.id_usuario, {
          nombre: this.nombre.trim(), apellido: this.apellido.trim(),
          activo: this.activo, roles: this.rolesSeleccionados,
          rut_empresa: this.esCuentaEmpresa ? this.rutEmpresa.trim() : null
        })
      : this.usuarioService.crear({
          nombre: this.nombre.trim(), apellido: this.apellido.trim(),
          correo: this.correo.trim().toLowerCase(), password: this.password,
          roles: this.rolesSeleccionados,
          rut_empresa: this.esCuentaEmpresa ? this.rutEmpresa.trim() : null
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

  private correoValido(correo: string): boolean {
    const limpio = correo.trim();
    return limpio.length <= 150
      && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio);
  }

  private mostrarToastRut(mensaje: string): void {
    this.mensajeToastRut = mensaje;
    this.toastRutAbierto = true;
  }
}
