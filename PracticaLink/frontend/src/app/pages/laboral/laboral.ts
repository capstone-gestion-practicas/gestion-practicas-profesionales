import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  from,
  forkJoin,
  map,
  of,
  switchMap,
  takeUntil
} from 'rxjs';
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
  IonTextarea,
  IonToast
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
import { EmpresaLookup } from '../../core/models/practica.models';
import { LaboralService } from '../../core/services/laboral.service';
import { AuthStore } from '../../core/store/auth.store';
import { MENSAJE_RUT_INVALIDO } from '../../core/utils/mensajes-rut';
import { formatearRut, rutValido } from '../../core/validators/rut.validator';

interface PhotonFeature {
  properties: {
    street?: string;
    housenumber?: string;
    city?: string;
    locality?: string;
    district?: string;
    state?: string;
    country?: string;
    countrycode?: string;
  };
}

interface PhotonResponse {
  features: PhotonFeature[];
}

@Component({
  selector: 'app-laboral',
  standalone: true,
  imports: [
    CommonModule, FormsModule, IonButton, IonCard, IonCardContent,
    IonContent, IonInput, IonItem, IonLabel, IonSelect, IonSelectOption,
    IonSpinner, IonTextarea, IonToast
  ],
  templateUrl: './laboral.html',
  styleUrl: './laboral.scss'
})
export class Laboral implements OnDestroy, OnInit {
  private readonly laboralService = inject(LaboralService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly consultasDireccion$ = new Subject<string>();
  private readonly destruir$ = new Subject<void>();
  toastRutAbierto = false;
  mensajeToastRut = '';

  readonly cargosPractica = [
    'Administración',
    'Analista de datos',
    'Asistente contable',
    'Atención al cliente',
    'Desarrollo de software',
    'Diseño gráfico',
    'Gestión de personas',
    'Marketing digital',
    'Prevención de riesgos',
    'Soporte TI',
    'Ventas'
  ];
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
  empresaConsultada: EmpresaLookup | null = null;
  consultandoEmpresa = false;
  errorConsultaEmpresa = '';
  cargo = '';
  cargoSeleccionado = '';
  cargoPersonalizado = '';
  descripcion = '';
  ubicacion = '';
  sugerenciasUbicacion: string[] = [];
  buscandoUbicacion = false;
  errorUbicacion = '';
  modalidad: ModalidadOferta = 'PRESENCIAL';
  requisitos = '';
  jornada: JornadaOferta = 'COMPLETA';
  fechaCierre = '';
  estado: EstadoOferta = 'PUBLICADA';

  ngOnInit(): void {
    this.conectarBuscadorDirecciones();
    const contexto = this.authStore.obtenerContextoActual();
    if (!contexto) {
      this.router.navigate(['/login']);
      return;
    }

    if (this.router.url.startsWith('/ofertas')
      && contexto.roles.includes('ESTUDIANTE')
      && !contexto.perfil) {
      this.router.navigate(['/home']);
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

  private conectarBuscadorDirecciones(): void {
    this.consultasDireccion$.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      switchMap(texto => {
        const consulta = texto.trim();
        if (consulta.length < 4) {
          this.buscandoUbicacion = false;
          this.sugerenciasUbicacion = [];
          this.errorUbicacion = '';
          return of([] as string[]);
        }

        this.buscandoUbicacion = true;
        this.errorUbicacion = '';
        const url = new URL('https://photon.komoot.io/api/');
        url.searchParams.set('q', consulta);
        url.searchParams.set('limit', '8');
        url.searchParams.set('lang', 'es');

        return from(fetch(url, { headers: { Accept: 'application/json' } }).then(async respuesta => {
          if (!respuesta.ok) throw new Error('No fue posible consultar OpenStreetMap.');
          return await respuesta.json() as PhotonResponse;
        })).pipe(
          map(resultado => [...new Set(
            (resultado.features ?? [])
              .filter(lugar => lugar.properties.countrycode?.toUpperCase() === 'CL')
              .map(lugar => this.formatearDireccion(lugar.properties))
              .filter((direccion): direccion is string => direccion !== null)
          )]),
          catchError(() => {
            this.errorUbicacion = 'No se pudieron cargar sugerencias. Puedes ingresar la calle manualmente.';
            return of([] as string[]);
          })
        );
      }),
      takeUntil(this.destruir$)
    ).subscribe(sugerencias => {
      this.sugerenciasUbicacion = sugerencias;
      this.buscandoUbicacion = false;
    });
  }

  private formatearDireccion(
    lugar: PhotonFeature['properties']
  ): string | null {
    if (!lugar.street) return null;
    const calle = [lugar.street, lugar.housenumber].filter(Boolean).join(' ');
    const comuna = lugar.city ?? lugar.locality ?? lugar.district;
    return [calle, comuna, lugar.state]
      .filter((parte, indice, partes) => !!parte && partes.indexOf(parte) === indice)
      .join(', ');
  }

  get rutEmpresaValido(): boolean {
    return rutValido(this.rutEmpresa);
  }

  cerrarToastRut(): void {
    this.toastRutAbierto = false;
  }

  actualizarUbicacion(evento: CustomEvent<{ value?: string | null }>): void {
    this.ubicacion = evento.detail.value ?? '';
    this.sugerenciasUbicacion = [];
    this.errorUbicacion = '';
    this.consultasDireccion$.next(this.ubicacion);
  }

  seleccionarUbicacion(direccion: string): void {
    this.ubicacion = direccion;
    this.sugerenciasUbicacion = [];
    this.errorUbicacion = '';
  }

  consultarRutEmpresa(): void {
    this.empresaConsultada = null;
    this.errorConsultaEmpresa = '';
    if (!rutValido(this.rutEmpresa)) {
      this.errorConsultaEmpresa = MENSAJE_RUT_INVALIDO;
      this.mostrarToastRut(MENSAJE_RUT_INVALIDO);
      return;
    }

    this.rutEmpresa = formatearRut(this.rutEmpresa);
    this.consultandoEmpresa = true;
    const rutConsultado = this.rutEmpresa;
    this.laboralService.consultarEmpresa(rutConsultado).subscribe({
      next: empresa => {
        if (this.rutEmpresa !== rutConsultado) return;
        this.consultandoEmpresa = false;
        if (!empresa.found) {
          this.errorConsultaEmpresa = 'No encontramos una empresa asociada a ese RUT.';
          return;
        }
        this.empresaConsultada = empresa;
      },
      error: (error: HttpErrorResponse) => {
        if (this.rutEmpresa !== rutConsultado) return;
        this.consultandoEmpresa = false;
        this.errorConsultaEmpresa = error.status === 404
          ? 'No encontramos una empresa asociada a ese RUT.'
          : this.detalleError(error, 'No fue posible validar el RUT de la empresa.');
      }
    });
  }

  actualizarRutEmpresa(rut: string): void {
    const rutFormateado = formatearRut(rut);
    if (rutFormateado === this.rutEmpresa) return;
    this.rutEmpresa = rutFormateado;
    this.toastRutAbierto = false;
    this.empresaConsultada = null;
    this.consultandoEmpresa = false;
    this.errorConsultaEmpresa = '';
    this.errorFormulario = '';
  }

  validarRutEmpresa(): void {
    if (!this.rutEmpresaValido) {
      this.mostrarToastRut(MENSAJE_RUT_INVALIDO);
    }
  }

  seleccionarCargo(cargo: string): void {
    this.cargoSeleccionado = cargo;
    if (cargo !== 'OTRO') this.cargoPersonalizado = '';
  }

  get ofertasFiltradas(): OfertaLaboral[] {
    const texto = this.busqueda.trim().toLocaleLowerCase();
    if (!texto) return this.ofertas;
    return this.ofertas.filter(oferta =>
      `${oferta.cargo} ${oferta.empresa} ${oferta.ubicacion}`
        .toLocaleLowerCase().includes(texto)
    );
  }

  get ubicacionEmpresaConsultada(): string {
    if (!this.empresaConsultada) return '';
    return [this.empresaConsultada.comuna, this.empresaConsultada.region]
      .filter((parte): parte is string => !!parte)
      .join(', ');
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
          practicas: this.laboralService.listarPracticasEmpresa(),
          cuenta: this.laboralService.obtenerCuentaEmpresa()
      }).subscribe({
        next: ({ ofertas, practicas, cuenta }) => {
          this.ofertas = ofertas;
          this.practicas = practicas;
          this.rutEmpresa = cuenta.rut_empresa;
          this.consultarRutEmpresa();
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
    this.empresaConsultada = null;
    this.errorConsultaEmpresa = '';
    if (this.vista === 'gestion') this.consultarRutEmpresa();
    this.cargo = oferta.cargo;
    this.cargoSeleccionado = this.cargosPractica.includes(oferta.cargo)
      ? oferta.cargo
      : 'OTRO';
    this.cargoPersonalizado = this.cargoSeleccionado === 'OTRO' ? oferta.cargo : '';
    this.descripcion = oferta.descripcion;
    this.ubicacion = oferta.ubicacion;
    this.consultasDireccion$.next('');
    this.sugerenciasUbicacion = [];
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
      this.mostrarToastRut(MENSAJE_RUT_INVALIDO);
      return;
    }
    if (this.vista === 'gestion' && !this.rutEmpresaValido) {
      this.errorFormulario = MENSAJE_RUT_INVALIDO;
      this.mostrarToastRut(MENSAJE_RUT_INVALIDO);
      return;
    }
    if (!this.empresaConsultada?.found
      || this.empresaConsultada.rut !== formatearRut(this.rutEmpresa)) {
      this.errorFormulario = 'Consulta y valida el RUT de la empresa antes de continuar.';
      return;
    }
    const cargoFinal = this.cargoSeleccionado === 'OTRO'
      ? this.cargoPersonalizado.trim()
      : this.cargoSeleccionado.trim();
    const descripcionFinal = this.descripcion.trim();
    if (!cargoFinal || !descripcionFinal
      || !this.ubicacion.trim() || !this.requisitos.trim()) {
      this.errorFormulario = 'Completa todos los campos obligatorios.';
      return;
    }
    if (Array.from(descripcionFinal).length < 10) {
      this.errorFormulario = 'La descripción debe tener al menos 10 caracteres.';
      return;
    }

    const datos: OfertaLaboralInput = {
      rut_empresa: this.vista === 'gestion' ? formatearRut(this.rutEmpresa) : null,
      cargo: cargoFinal,
      descripcion: descripcionFinal,
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
    this.empresaConsultada = null;
    this.consultandoEmpresa = false;
    this.errorConsultaEmpresa = '';
    this.cargo = '';
    this.cargoSeleccionado = '';
    this.cargoPersonalizado = '';
    this.descripcion = '';
    this.ubicacion = '';
    this.consultasDireccion$.next('');
    this.sugerenciasUbicacion = [];
    this.buscandoUbicacion = false;
    this.errorUbicacion = '';
    this.modalidad = 'PRESENCIAL';
    this.requisitos = '';
    this.jornada = 'COMPLETA';
    this.fechaCierre = '';
    this.estado = 'PUBLICADA';
    this.errorFormulario = '';
  }

  ngOnDestroy(): void {
    this.destruir$.next();
    this.destruir$.complete();
    this.consultasDireccion$.complete();
  }

  private fallarCarga(mensaje: string): void {
    this.error = mensaje;
    this.cargando = false;
  }

  private mostrarToastRut(mensaje: string): void {
    this.mensajeToastRut = mensaje;
    this.toastRutAbierto = true;
  }

  private detalleError(error: HttpErrorResponse, alternativa: string): string {
    return typeof error.error?.detail === 'string' ? error.error.detail : alternativa;
  }
}
