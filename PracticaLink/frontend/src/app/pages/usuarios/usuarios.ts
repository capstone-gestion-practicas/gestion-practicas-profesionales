import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AlertController, IonButton, IonCard, IonCardContent, IonCheckbox, IonContent, IonInput,
  IonItem, IonModal, IonSpinner, IonToggle, IonGrid, IonRow, IonCol
} from '@ionic/angular';
import { forkJoin } from 'rxjs';

import { Rol, UsuarioAdministrable } from '../../core/models/usuario.models';
import { UsuarioService } from '../../core/services/usuario.service';
import { AuthStore } from '../../core/store/auth.store';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [
    CommonModule, FormsModule, IonButton, IonCard, IonCardContent, IonCheckbox,
    IonContent, IonInput, IonItem, IonModal, IonSpinner, IonToggle, IonGrid, IonRow, IonCol
  ],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.scss'
})
export class Usuarios implements OnInit {
  private readonly usuarioService = inject(UsuarioService);
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly authStore = inject(AuthStore);

  usuarios: UsuarioAdministrable[] = [];
  roles: Rol[] = [];
  busqueda = '';
  filtroRol = '';
  filtroActivo = '';
  pagina = 1;
  readonly tamanoPagina = 12;

  // GET /usuarios devuelve el conjunto completo (sin limit/offset).
  get filtrados(): UsuarioAdministrable[] {
    const consulta = this.busqueda.trim().toLocaleLowerCase();
    return this.usuarios.filter(usuario =>
      (!consulta || `${usuario.nombre} ${usuario.apellido} ${usuario.correo}`.toLocaleLowerCase().includes(consulta))
      && (!this.filtroRol || usuario.roles.includes(this.filtroRol))
      && (!this.filtroActivo || usuario.activo === (this.filtroActivo === 'activo'))
    );
  }
  get totalPaginas(): number { return Math.max(1, Math.ceil(this.filtrados.length / this.tamanoPagina)); }
  get visibles(): UsuarioAdministrable[] {
    const inicio = (this.pagina - 1) * this.tamanoPagina;
    return this.filtrados.slice(inicio, inicio + this.tamanoPagina);
  }
  actualizarFiltros(): void { this.pagina = 1; }
  cambiarPagina(pagina: number): void { this.pagina = Math.max(1, Math.min(pagina, this.totalPaginas)); }
  cargando = true;
  error = '';
  errorAccion = '';
  desactivando = false;
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
        this.pagina = Math.min(this.pagina, this.totalPaginas);
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
    if (!this.usuarioEditando && !this.correoValido(this.correo)) {
      this.errorModal = 'Ingresa un correo válido de máximo 150 caracteres.';
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
          correo: this.correo.trim().toLowerCase(), password: this.password,
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

  /** La cuenta propia no puede desactivarse: el backend también lo impide (AUTOGESTION_NO_PERMITIDA). */
  esUsuarioActual(usuario: UsuarioAdministrable): boolean {
    return this.authStore.contexto()?.usuario.id_usuario === usuario.id_usuario;
  }

  async confirmarEliminar(usuario: UsuarioAdministrable): Promise<void> {
    const alerta = await this.alertController.create({
      header: 'Desactivar cuenta',
      message: `La cuenta de ${usuario.nombre} ${usuario.apellido} quedará inactiva y no podrá iniciar sesión. `
        + 'Sus datos se conservan y puede reactivarse desde Editar usuario.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Desactivar', role: 'destructive', handler: () => this.desactivar(usuario) }
      ]
    });
    await alerta.present();
  }

  /** Eliminación lógica: reutiliza PATCH /usuarios/{id} con activo = false y conserva roles y datos. */
  desactivar(usuario: UsuarioAdministrable): void {
    this.desactivando = true;
    this.errorAccion = '';
    this.usuarioService.actualizar(usuario.id_usuario, {
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      activo: false,
      roles: usuario.roles
    }).subscribe({
      next: () => {
        this.desactivando = false;
        this.cargar();
      },
      error: (error: HttpErrorResponse) => {
        this.desactivando = false;
        this.errorAccion = typeof error.error?.detail === 'string'
          ? error.error.detail : 'No fue posible desactivar la cuenta.';
      }
    });
  }

  private correoValido(correo: string): boolean {
    const limpio = correo.trim();
    return limpio.length <= 150
      && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio);
  }
}
