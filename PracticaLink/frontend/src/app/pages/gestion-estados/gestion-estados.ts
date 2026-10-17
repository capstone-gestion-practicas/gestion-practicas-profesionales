import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
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
  HistorialEstadoPractica,
  PracticaEstadoResumen
} from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';

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
  readonly historiales = new Map<number, HistorialEstadoPractica[]>();
  cargando = true;
  error = '';
  busqueda = '';
  mensaje = '';
  errorHistorial = '';
  cargandoHistorialId: number | null = null;
  historialAbiertoId: number | null = null;
  modalAbierto = false;
  guardando = false;
  practicaSeleccionada: PracticaEstadoResumen | null = null;
  idEstadoSeleccionado: number | null = null;
  observacion = '';

  constructor(
    private readonly practicaService: PracticaService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
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
        this.cargando = false;
      },
      error: () => {
        this.error = 'No fue posible cargar las prácticas y los estados disponibles.';
        this.cargando = false;
      }
    });
  }

  practicasFiltradas(): PracticaEstadoResumen[] {
    const consulta = this.busqueda.trim().toLocaleLowerCase();
    if (!consulta) return this.practicas;
    return this.practicas.filter(practica => [
      practica.estudiante,
      practica.rut_estudiante,
      practica.centro_practica,
      practica.estado
    ].some(valor => valor.toLocaleLowerCase().includes(consulta)));
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
    if (!this.practicaSeleccionada || this.idEstadoSeleccionado === null) return;

    this.guardando = true;
    this.error = '';
    this.practicaService.actualizarEstado(
      this.practicaSeleccionada.id_practica,
      this.idEstadoSeleccionado,
      this.observacion.trim() || null
    ).subscribe({
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
}
