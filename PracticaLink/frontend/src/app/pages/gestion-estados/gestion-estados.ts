import { EvaluacionService, EstadoAcademico, aprobacionVigente } from '../../features/evaluaciones/evaluacion.service';
import {
  esCandidataCierre,
  fechaTerminoCumplida,
  mensajeAprobacionAcademica,
  mensajeErrorConsultaAcademica
} from '../../features/gestor/cierre-practica/cierre-reglas';
import { CommonModule } from '@angular/common';
import { Component, Injector, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription, forkJoin, map } from 'rxjs';
import { EstadoBadge } from '../../shared/components/estado-badge/estado-badge';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonCol,
  IonContent,
  IonGrid,
  IonItem,
  IonLabel,
  IonModal,
  IonRow,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea
} from '@ionic/angular';

import {
  ActualizarEstadoPracticaResponse,
  EstadoPracticaDetalle,
  GestorPractica,
  HistorialEstadoPractica,
  IniciarPracticaResponse,
  PracticaEstadoResumen
} from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { esEspacioGestorDedicado } from '../../core/navigation/espacio-gestor';

@Component({
  selector: 'app-gestion-estados',
  standalone: true,
  imports: [
    CommonModule,
    EstadoBadge,
    FormsModule,
    IonBadge,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonCol,
    IonContent,
    IonGrid,
    IonItem,
    IonLabel,
    IonModal,
    IonRow,
    IonSearchbar,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTextarea
  ],
  templateUrl: './gestion-estados.html',
  styleUrl: './gestion-estados.scss'
})
export class GestionEstados implements OnInit, OnDestroy {
  private readonly injector = inject(Injector);
  private readonly consultasAcademicas = new Subscription();
  readonly estadosAcademicos = new Map<number, EstadoAcademico>();
  readonly erroresAcademicos = new Map<number, string>();
  readonly consultandoAcademico = new Set<number>();
  private generacionAcademica = 0;
  ngOnDestroy(): void { this.consultasAcademicas.unsubscribe(); }
  private readonly authStore = inject(AuthStore);
  practicas: PracticaEstadoResumen[] = [];
  estados: EstadoPracticaDetalle[] = [];
  gestores: GestorPractica[] = [];
  readonly gestorSeleccionado = new Map<number, number | null>();
  readonly historiales = new Map<number, HistorialEstadoPractica[]>();
  cargando = true;
  error = '';
  busqueda = '';
  filtroEstado: string | null = null;
  mensaje = '';
  errorHistorial = '';
  cargandoHistorialId: number | null = null;
  historialAbiertoId: number | null = null;
  modalAbierto = false;
  guardando = false;
  practicaSeleccionada: PracticaEstadoResumen | null = null;
  idEstadoSeleccionado: number | null = null;
  observacion = '';
  errorGestores = '';
  guardandoAsignacionId: number | null = null;
  guardandoCierreId: number | null = null;
  readonly esAdministrador: boolean;

  constructor(
    private readonly practicaService: PracticaService,
    authStore: AuthStore,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {
    this.esAdministrador = authStore.obtenerContextoActual()?.roles
      .some(rol => rol.toUpperCase() === 'ADMINISTRADOR') ?? false;
  }

  ngOnInit(): void {
    this.filtroEstado = this.route.snapshot.queryParamMap.get('estado')?.toUpperCase() ?? null;
    this.cargar();
  }

  cargar(): void {
    this.cargando = true;
    this.generacionAcademica++; this.estadosAcademicos.clear(); this.erroresAcademicos.clear();
    this.consultandoAcademico.clear();
    this.error = '';
    forkJoin({
      practicas: this.practicaService.listarPracticasParaGestion(),
      estados: this.practicaService.listarEstados()
    }).subscribe({
      next: ({ practicas, estados }) => {
        this.practicas = practicas;
        this.estados = estados;
        this.gestorSeleccionado.clear();
        practicas.forEach(practica =>
          this.gestorSeleccionado.set(practica.id_practica, practica.id_gestor)
        );
        this.cargando = false;
        if (this.esAdministrador) this.cargarGestores();
      },
      error: () => {
        this.error = 'No fue posible cargar las prácticas y los estados disponibles.';
        this.cargando = false;
      }
    });
  }

  practicasFiltradas(): PracticaEstadoResumen[] {
    const consulta = this.busqueda.trim().toLocaleLowerCase();
    return this.practicas.filter(practica => {
      const coincideEstado = !this.filtroEstado
        || practica.estado.toUpperCase() === this.filtroEstado;
      const coincideBusqueda = !consulta || [
        practica.estudiante,
        practica.rut_estudiante,
        practica.centro_practica,
        practica.estado
      ].some(valor => valor.toLocaleLowerCase().includes(consulta));
      return coincideEstado && coincideBusqueda;
    });
  }

  practicasVencidas(): PracticaEstadoResumen[] {
    return this.practicasFiltradas().filter(practica =>
      !practica.es_final && this.fechaTerminoVencida(practica.fecha_termino)
    );
  }

  practicasEnSeguimiento(): PracticaEstadoResumen[] {
    return this.practicasFiltradas().filter(practica =>
      practica.es_final || !this.fechaTerminoVencida(practica.fecha_termino)
    );
  }

  fechaTerminoVencida(fechaTermino: string | null): boolean {
    return fechaTerminoCumplida(fechaTermino);
  }

  puedeFinalizar(practica: PracticaEstadoResumen): boolean {
    return this.candidataCierre(practica) && aprobacionVigente(this.estadosAcademicos.get(practica.id_practica));
  }

  candidataCierre(practica: PracticaEstadoResumen): boolean {
    return esCandidataCierre(practica, this.authStore.obtenerContextoActual());
  }

  consultarAprobacion(practica: PracticaEstadoResumen): void {
    const id = practica.id_practica;
    if (!this.candidataCierre(practica) || this.consultandoAcademico.has(id) || this.guardandoCierreId !== null) return;
    const generacion = this.generacionAcademica;
    this.estadosAcademicos.delete(id); this.erroresAcademicos.delete(id); this.consultandoAcademico.add(id);
    this.consultasAcademicas.add(this.injector.get(EvaluacionService).vigente(id).subscribe({
      next: estado => {
        if (generacion !== this.generacionAcademica) return;
        this.estadosAcademicos.set(id, estado); this.consultandoAcademico.delete(id);
      },
      error: (error: HttpErrorResponse) => {
        if (generacion !== this.generacionAcademica) return;
        this.consultandoAcademico.delete(id);
        this.erroresAcademicos.set(id, mensajeErrorConsultaAcademica(error.status));
      }
    }));
  }

  mensajeAcademico(id: number): string {
    return mensajeAprobacionAcademica(this.consultandoAcademico.has(id), this.estadosAcademicos.get(id));
  }

  nombreEstado(estado: string): string {
    return estado.replaceAll('_', ' ');
  }

  limpiarFiltroEstado(): void {
    this.filtroEstado = null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { estado: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  abrirCambio(practica: PracticaEstadoResumen): void {
    this.practicaSeleccionada = practica;
    this.idEstadoSeleccionado = practica.id_estado;
    this.observacion = '';
    this.error = '';
    this.modalAbierto = true;
  }

  cerrarModal(): void {
    if (!this.guardando) this.modalAbierto = false;
  }

  guardarCambio(): void {
    const practica = this.practicaSeleccionada;
    const idEstado = this.idEstadoSeleccionado;
    if (!practica || idEstado === null) return;

    this.guardando = true;
    this.error = '';
    const estadoSeleccionado = this.estados.find(
      estado => estado.id_estado === idEstado
    );
    // Tipo explícito de la unión: evita pipe() sobre Observable<A> | Observable<B>.
    const solicitud: Observable<ActualizarEstadoPracticaResponse | IniciarPracticaResponse> =
      estadoSeleccionado?.nombre === 'EN_CURSO'
        ? this.practicaService.iniciarPractica(
          practica.id_practica, this.observacion.trim() || null
        )
        : this.practicaService.actualizarEstado(
          practica.id_practica, idEstado,
          this.observacion.trim() || null
        );
    const operacion = solicitud.pipe(map(respuesta => ({
        id_practica: respuesta.id_practica,
        mensaje: respuesta.mensaje
      })));
    operacion.subscribe({
      next: respuesta => {
        this.mensaje = respuesta.mensaje;
        this.guardando = false;
        this.modalAbierto = false;
        this.historiales.delete(respuesta.id_practica);
        this.cargar();
        this.mostrarMensajeTemporal();
      },
      error: (error: HttpErrorResponse) => {
        this.guardando = false;
        this.error = error.error?.detail ?? 'No fue posible actualizar el estado.';
      }
    });
  }

  guardarAsignacion(practica: PracticaEstadoResumen): void {
    if (!this.esAdministrador) return;
    this.guardandoAsignacionId = practica.id_practica;
    this.errorGestores = '';
    this.practicaService.asignarGestor(
      practica.id_practica,
      this.gestorSeleccionado.get(practica.id_practica) ?? null
    ).subscribe({
      next: respuesta => {
        this.mensaje = respuesta.mensaje;
        this.guardandoAsignacionId = null;
        this.historiales.delete(practica.id_practica);
        this.cargar();
        this.mostrarMensajeTemporal();
      },
      error: (error: HttpErrorResponse) => {
        this.guardandoAsignacionId = null;
        this.errorGestores = error.error?.detail ?? 'No fue posible asignar el gestor.';
      }
    });
  }

  finalizarPractica(practica: PracticaEstadoResumen): void {
    if (!this.puedeFinalizar(practica) || this.guardandoCierreId !== null) return;
    this.guardandoCierreId = practica.id_practica;
    this.error = '';
    this.practicaService.cerrarPractica(practica.id_practica, null).subscribe({
      next: respuesta => {
        this.mensaje = respuesta.mensaje;
        this.guardandoCierreId = null;
        this.historiales.delete(practica.id_practica);
        this.cargar();
        this.mostrarMensajeTemporal();
      },
      error: (error: HttpErrorResponse) => {
        this.guardandoCierreId = null;
        this.estadosAcademicos.delete(practica.id_practica);
        this.error = error.error?.detail ?? 'No fue posible finalizar la práctica.';
      }
    });
  }

  alternarHistorial(practica: PracticaEstadoResumen): void {
    const idPractica = practica.id_practica;
    if (this.historialAbiertoId === idPractica) {
      this.historialAbiertoId = null;
      return;
    }

    this.historialAbiertoId = idPractica;
    this.errorHistorial = '';
    if (this.historiales.has(idPractica)) return;

    this.cargandoHistorialId = idPractica;
    this.practicaService.obtenerHistorialEstados(idPractica).subscribe({
      next: historial => {
        this.historiales.set(idPractica, historial);
        this.cargandoHistorialId = null;
      },
      error: () => {
        this.cargandoHistorialId = null;
        this.errorHistorial = 'No fue posible cargar el historial de esta práctica.';
      }
    });
  }

  historialDe(idPractica: number): HistorialEstadoPractica[] {
    return this.historiales.get(idPractica) ?? [];
  }

  /**
   * Distingue el vacío legítimo por alcance (gestor sin prácticas asignadas) del vacío por filtro.
   * Un error HTTP se muestra antes, en su propia tarjeta, y nunca llega aquí.
   */
  mensajeListaVacia(): string {
    if (this.practicas.length === 0) {
      return this.esAdministrador
        ? 'No hay prácticas registradas.'
        : 'Aún no tienes prácticas asignadas. Un administrador debe asignártelas para verlas aquí.';
    }
    return 'No hay prácticas que coincidan con la búsqueda o el filtro aplicado.';
  }

  mostrarVolver(): boolean {
    return !esEspacioGestorDedicado(this.authStore.obtenerContextoActual());
  }

  volver(): void {
    this.router.navigate(['/home']);
  }

  /** Abre el detalle de la práctica, donde el gestor responsable puede asignar un docente. */
  verDetalle(practica: PracticaEstadoResumen): void {
    this.router.navigate(['/practicas', practica.id_practica]);
  }

  private mostrarMensajeTemporal(): void {
    window.setTimeout(() => this.mensaje = '', 5000);
  }

  private cargarGestores(): void {
    this.errorGestores = '';
    this.practicaService.listarGestores().subscribe({
      next: gestores => this.gestores = gestores,
      error: (error: HttpErrorResponse) => {
        this.errorGestores = error.error?.detail
          ?? 'No fue posible cargar los gestores disponibles.';
      }
    });
  }
}
