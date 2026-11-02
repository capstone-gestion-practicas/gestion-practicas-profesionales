import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea
} from '@ionic/angular';

import {
  EstadoOferta,
  EstadoPostulacion,
  HistorialPostulacion,
  JornadaOferta,
  ModalidadOferta,
  OfertaLaboral,
  OfertaLaboralInput,
  PostulacionEmpresa,
  PostulacionEstudiante,
  PracticaEmpresa
} from '../../core/models/laboral.models';
import { LaboralService } from '../../core/services/laboral.service';
import { AuthStore } from '../../core/store/auth.store';

@Component({
  selector: 'app-laboral',
  standalone: true,
  imports: [
    CommonModule, FormsModule, IonButton, IonCard, IonCardContent,
    IonContent, IonInput, IonItem, IonLabel, IonSelect, IonSelectOption,
    IonSpinner, IonTextarea
  ],
  templateUrl: './laboral.html',
  styleUrl: './laboral.scss'
})
export class Laboral implements OnInit {
  private readonly laboralService = inject(LaboralService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  readonly modalidades: ModalidadOferta[] = ['PRESENCIAL', 'HIBRIDA', 'REMOTA'];
  readonly jornadas: JornadaOferta[] = ['COMPLETA', 'PARCIAL', 'PROYECTO', 'PRACTICA'];
  readonly estadosOferta: EstadoOferta[] = ['BORRADOR', 'PUBLICADA', 'CERRADA'];
  readonly estadosPostulacion: EstadoPostulacion[] = [
    'RECIBIDA', 'EN_REVISION', 'SELECCIONADA', 'RECHAZADA'
  ];

  vista: 'empresa' | 'estudiante' | 'gestion' = 'estudiante';
  ofertas: OfertaLaboral[] = [];
  practicas: PracticaEmpresa[] = [];
  misPostulaciones: PostulacionEstudiante[] = [];
  postulaciones = new Map<number, PostulacionEmpresa[]>();
  historiales = new Map<number, HistorialPostulacion[]>();
  cargando = true;
  guardando = false;
  error = '';
  errorFormulario = '';
  mensaje = '';
  busqueda = '';
  ofertaEditandoId: number | null = null;
  postulacionesAbiertasId: number | null = null;
  postulacionActivaId: number | null = null;
  cartaPresentacion = '';
  cargandoPostulacionesId: number | null = null;
  cargandoHistorialId: number | null = null;
  historialAbiertoId: number | null = null;

  rutEmpresa = '';
  cargo = '';
  descripcion = '';
  ubicacion = '';
  modalidad: ModalidadOferta = 'PRESENCIAL';
  requisitos = '';
  jornada: JornadaOferta = 'COMPLETA';
  fechaCierre = '';
  estado: EstadoOferta = 'PUBLICADA';

  ngOnInit(): void {
    const contexto = this.authStore.obtenerContextoActual();
    if (!contexto) {
      this.router.navigate(['/login']);
      return;
    }

    if (contexto.roles.includes('EMPRESA')) {
      this.vista = 'empresa';
    } else if (this.router.url.startsWith('/gestion-ofertas')) {
      this.vista = 'gestion';
    } else if (contexto.roles.includes('ESTUDIANTE')) {
      this.vista = 'estudiante';
    } else {
      this.router.navigate(['/home']);
      return;
    }
    this.cargar();
  }

  get ofertasFiltradas(): OfertaLaboral[] {
    const texto = this.busqueda.trim().toLocaleLowerCase();
    if (!texto) return this.ofertas;
    return this.ofertas.filter(oferta =>
      `${oferta.cargo} ${oferta.empresa} ${oferta.ubicacion}`
        .toLocaleLowerCase().includes(texto)
    );
  }

  cargar(): void {
    this.cargando = true;
    this.error = '';
    if (this.vista === 'estudiante') {
      forkJoin({
        ofertas: this.laboralService.listarOfertasPublicadas(),
        postulaciones: this.laboralService.listarMisPostulaciones()
      }).subscribe({
        next: ({ ofertas, postulaciones }) => {
          this.ofertas = ofertas;
          this.misPostulaciones = postulaciones;
          this.cargando = false;
        },
        error: () => this.fallarCarga('No fue posible cargar ofertas y postulaciones.')
      });
      return;
    }

    if (this.vista === 'empresa') {
      forkJoin({
          ofertas: this.laboralService.listarOfertasGestion(),
          practicas: this.laboralService.listarPracticasEmpresa()
      }).subscribe({
        next: ({ ofertas, practicas }) => {
          this.ofertas = ofertas;
          this.practicas = practicas;
          this.cargando = false;
        },
        error: () => this.fallarCarga('No fue posible cargar el portal laboral.')
      });
      return;
    }

    this.laboralService.listarOfertasGestion().subscribe({
      next: ofertas => {
        this.ofertas = ofertas;
        this.cargando = false;
      },
      error: () => this.fallarCarga('No fue posible cargar el portal laboral.')
    });
  }

  nuevaOferta(): void {
    this.limpiarFormulario();
    this.ofertaEditandoId = null;
  }

  editarOferta(oferta: OfertaLaboral): void {
    this.ofertaEditandoId = oferta.id_oferta;
    this.rutEmpresa = oferta.rut_empresa;
    this.cargo = oferta.cargo;
    this.descripcion = oferta.descripcion;
    this.ubicacion = oferta.ubicacion;
    this.modalidad = oferta.modalidad;
    this.requisitos = oferta.requisitos;
    this.jornada = oferta.jornada;
    this.fechaCierre = oferta.fecha_cierre ?? '';
    this.estado = oferta.estado;
    this.errorFormulario = '';
  }

  guardarOferta(): void {
    this.errorFormulario = '';
    this.mensaje = '';
    if (this.vista === 'gestion' && !this.rutEmpresa.trim()) {
      this.errorFormulario = 'Ingresa el RUT de la empresa asociada.';
      return;
    }
    if (!this.cargo.trim() || !this.descripcion.trim()
      || !this.ubicacion.trim() || !this.requisitos.trim()) {
      this.errorFormulario = 'Completa todos los campos obligatorios.';
      return;
    }

    const datos: OfertaLaboralInput = {
      rut_empresa: this.vista === 'gestion' ? this.rutEmpresa.trim() : null,
      cargo: this.cargo.trim(),
      descripcion: this.descripcion.trim(),
      ubicacion: this.ubicacion.trim(),
      modalidad: this.modalidad,
      requisitos: this.requisitos.trim(),
      jornada: this.jornada,
      fecha_cierre: this.fechaCierre || null,
      estado: this.estado
    };
    this.guardando = true;
    this.laboralService.guardarOferta(datos, this.ofertaEditandoId ?? undefined).subscribe({
      next: resultado => {
        this.guardando = false;
        this.mensaje = resultado.mensaje;
        this.limpiarFormulario();
        this.cargar();
      },
      error: (error: HttpErrorResponse) => {
        this.guardando = false;
        this.errorFormulario = this.detalleError(error, 'No fue posible guardar la oferta.');
      }
    });
  }

  cerrarOferta(oferta: OfertaLaboral): void {
    this.laboralService.guardarOferta({
      rut_empresa: this.vista === 'gestion' ? oferta.rut_empresa : null,
      cargo: oferta.cargo,
      descripcion: oferta.descripcion,
      ubicacion: oferta.ubicacion,
      modalidad: oferta.modalidad,
      requisitos: oferta.requisitos,
      jornada: oferta.jornada,
      fecha_cierre: oferta.fecha_cierre,
      estado: 'CERRADA'
    }, oferta.id_oferta).subscribe({
      next: () => this.cargar(),
      error: error => this.error = this.detalleError(
        error, 'No fue posible cerrar la oferta.'
      )
    });
  }

  verPostulaciones(oferta: OfertaLaboral): void {
    if (this.postulacionesAbiertasId === oferta.id_oferta) {
      this.postulacionesAbiertasId = null;
      return;
    }
    this.postulacionesAbiertasId = oferta.id_oferta;
    this.cargandoPostulacionesId = oferta.id_oferta;
    this.laboralService.listarPostulaciones(oferta.id_oferta).subscribe({
      next: postulaciones => {
        this.postulaciones.set(oferta.id_oferta, postulaciones);
        this.cargandoPostulacionesId = null;
      },
      error: error => {
        this.cargandoPostulacionesId = null;
        this.error = this.detalleError(error, 'No fue posible cargar las postulaciones.');
      }
    });
  }

  cambiarEstadoPostulacion(postulacion: PostulacionEmpresa, estado: EstadoPostulacion): void {
    this.laboralService.actualizarPostulacion(postulacion.id_postulacion, estado).subscribe({
      next: () => {
        postulacion.estado = estado;
        this.laboralService.listarPostulaciones(postulacion.id_oferta).subscribe({
          next: postulaciones => this.postulaciones.set(postulacion.id_oferta, postulaciones),
          error: error => this.error = this.detalleError(
            error, 'No fue posible actualizar la lista de postulaciones.'
          )
        });
      },
      error: error => this.error = this.detalleError(
        error, 'No fue posible actualizar la postulación.'
      )
    });
  }

  postular(oferta: OfertaLaboral): void {
    this.guardando = true;
    this.error = '';
    this.laboralService.postular(oferta.id_oferta, this.cartaPresentacion.trim() || null).subscribe({
      next: () => {
        this.guardando = false;
        this.postulacionActivaId = null;
        this.cartaPresentacion = '';
        this.cargar();
      },
      error: error => {
        this.guardando = false;
        this.error = this.detalleError(error, 'No fue posible enviar la postulación.');
      }
    });
  }

  abrirFormularioPostulacion(idOferta: number): void {
    this.postulacionActivaId = idOferta;
    this.cartaPresentacion = '';
  }

  yaPostulo(idOferta: number): boolean {
    return this.misPostulaciones.some(postulacion => postulacion.id_oferta === idOferta);
  }

  verHistorial(idPostulacion: number): void {
    if (this.historialAbiertoId === idPostulacion) {
      this.historialAbiertoId = null;
      return;
    }
    this.historialAbiertoId = idPostulacion;
    this.cargandoHistorialId = idPostulacion;
    this.laboralService.historialPostulacion(idPostulacion).subscribe({
      next: historial => {
        this.historiales.set(idPostulacion, historial);
        this.cargandoHistorialId = null;
      },
      error: error => {
        this.cargandoHistorialId = null;
        this.error = this.detalleError(error, 'No fue posible cargar el historial.');
      }
    });
  }

  cerrarSesion(): void {
    sessionStorage.removeItem('access_token');
    this.authStore.limpiar();
    this.router.navigate(['/login']);
  }

  volver(): void {
    this.router.navigate([this.vista === 'empresa' ? '/portal-empresa' : '/home']);
  }

  private limpiarFormulario(): void {
    this.ofertaEditandoId = null;
    this.rutEmpresa = '';
    this.cargo = '';
    this.descripcion = '';
    this.ubicacion = '';
    this.modalidad = 'PRESENCIAL';
    this.requisitos = '';
    this.jornada = 'COMPLETA';
    this.fechaCierre = '';
    this.estado = 'PUBLICADA';
    this.errorFormulario = '';
  }

  private fallarCarga(mensaje: string): void {
    this.error = mensaje;
    this.cargando = false;
  }

  private detalleError(error: HttpErrorResponse, alternativa: string): string {
    return typeof error.error?.detail === 'string' ? error.error.detail : alternativa;
  }
}
