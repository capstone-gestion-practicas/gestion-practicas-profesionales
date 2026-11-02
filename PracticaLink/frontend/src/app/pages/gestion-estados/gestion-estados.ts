import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, map } from 'rxjs';
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
  EstadoPracticaDetalle,
  GestorPractica,
  HistorialEstadoPractica,
  PracticaEstadoResumen
} from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';

@Component({
  selector: 'app-gestion-estados',
  standalone: true,
  imports: [
    CommonModule,
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
export class GestionEstados implements OnInit {
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
    if (!fechaTermino) return false;
    const hoy = new Date();
    const hoyIso = [hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate()]
      .map((parte, indice) => indice === 0 ? String(parte) : String(parte).padStart(2, '0'))
      .join('-');
    return fechaTermino.slice(0, 10) <= hoyIso;
  }

  puedeFinalizar(practica: PracticaEstadoResumen): boolean {
    return practica.estado === 'EN_CURSO'
      && this.fechaTerminoVencida(practica.fecha_termino);
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
    const operacion = (estadoSeleccionado?.nombre === 'EN_CURSO'
      ? this.practicaService.iniciarPractica(
        practica.id_practica, this.observacion.trim() || null
      )
      : this.practicaService.actualizarEstado(
        practica.id_practica, idEstado,
        this.observacion.trim() || null
      )).pipe(map(respuesta => ({
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
    if (!this.puedeFinalizar(practica)) return;
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

  volver(): void {
    this.router.navigate(['/home']);
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
