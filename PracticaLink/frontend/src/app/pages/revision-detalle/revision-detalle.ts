import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonContent, IonItem, IonLabel, IonModal, IonSelect, IonSelectOption,
  IonSpinner, IonTextarea, IonGrid, IonRow, IonCol
} from '@ionic/angular';

import {
  DecisionRevision,
  SolicitudRevisionDetalle
} from '../../core/models/revision.models';
import { EstadoPracticaDetalle } from '../../core/models/practica.models';
import { RevisionService } from '../../core/services/revision.service';
import { PracticaService } from '../../core/services/practica.service';
import { formatoHorasEstimadas } from '../../core/utils/horas-estimadas';

@Component({
  selector: 'app-revision-detalle', standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonCard, IonCardHeader,
    IonCardTitle, IonCardContent, IonButton, IonItem, IonLabel, IonSelect,
    IonSelectOption, IonModal, IonSpinner, IonTextarea, IonGrid, IonRow, IonCol],
  templateUrl: './revision-detalle.html', styleUrl: './revision-detalle.scss'
})
export class RevisionDetalle implements OnInit {
  solicitud: SolicitudRevisionDetalle | null = null;
  cargando = true;
  error = '';
  modalAbierto = false;
  guardando = false;
  decision: DecisionRevision = 'APROBADA';
  observacion = '';
  estados: EstadoPracticaDetalle[] = [];
  idEstadoSeleccionado: number | null = null;
  observacionEstado = '';
  guardandoEstado = false;
  mensajeEstado = '';
  errorEstado = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly revisionService: RevisionService,
    private readonly practicaService: PracticaService
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    forkJoin({
      solicitud: this.revisionService.obtener(id),
      estados: this.practicaService.listarEstados()
    }).subscribe({
      next: ({ solicitud, estados }) => {
        this.solicitud = solicitud;
        this.estados = estados;
        this.idEstadoSeleccionado = estados.find(
          estado => estado.nombre.toUpperCase() === solicitud.estado.toUpperCase()
        )?.id_estado ?? null;
        this.cargando = false;
      },
      error: () => { this.error = 'No fue posible cargar la solicitud.'; this.cargando = false; }
    });
  }

  guardarEstado(): void {
    if (!this.solicitud || this.idEstadoSeleccionado === null) return;
    this.guardandoEstado = true;
    this.errorEstado = '';
    this.mensajeEstado = '';
    this.practicaService.actualizarEstado(
      this.solicitud.id_practica,
      this.idEstadoSeleccionado,
      this.observacionEstado.trim() || null
    ).subscribe({
      next: respuesta => {
        this.solicitud = { ...this.solicitud!, estado: respuesta.estado };
        this.idEstadoSeleccionado = respuesta.id_estado;
        this.observacionEstado = '';
        this.mensajeEstado = respuesta.mensaje;
        this.guardandoEstado = false;
      },
      error: (error: HttpErrorResponse) => {
        this.guardandoEstado = false;
        this.errorEstado = error.error?.detail ?? 'No fue posible actualizar el estado.';
      }
    });
  }

  abrirDecision(decision: DecisionRevision): void {
    this.decision = decision;
    this.observacion = '';
    this.error = '';
    this.modalAbierto = true;
  }

  cerrarModal(): void { if (!this.guardando) this.modalAbierto = false; }

  confirmar(): void {
    if (!this.solicitud) return;
    if (this.decision !== 'APROBADA' && !this.observacion.trim()) {
      this.error = 'Debes ingresar una observación.';
      return;
    }
    this.guardando = true;
    this.revisionService.resolver(
      this.solicitud.id_practica,
      this.decision,
      this.observacion.trim() || null
    ).subscribe({
      next: () => { this.guardando = false; this.router.navigate(['/revisiones']); },
      error: (error: HttpErrorResponse) => {
        this.guardando = false;
        this.error = error.error?.detail ?? 'No fue posible guardar la decisión.';
      }
    });
  }

  volver(): void { this.router.navigate(['/revisiones']); }

  estimacionHoras(
    fechaInicio: string | null,
    fechaTermino: string | null,
    horasSemanales: number | null
  ): string {
    return formatoHorasEstimadas(fechaInicio, fechaTermino, horasSemanales);
  }
}
