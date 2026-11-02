import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
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
  IonInput,
  IonRow,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea
} from '@ionic/angular';

import {
  EstadoIncidencia,
  IncidenciaPractica,
  PracticaEstadoResumen
} from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';

@Component({
  selector: 'app-incidencias',
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
    IonInput,
    IonRow,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTextarea
  ],
  templateUrl: './incidencias.html',
  styleUrl: './incidencias.scss'
})
export class Incidencias implements OnInit {
  readonly estados: EstadoIncidencia[] = ['ABIERTA', 'EN_REVISION', 'RESUELTA', 'CERRADA'];
  practicas: PracticaEstadoResumen[] = [];
  incidencias: IncidenciaPractica[] = [];
  practicaSeleccionada: number | null = null;
  fecha = '';
  descripcion = '';
  prioridad: IncidenciaPractica['prioridad'] = 'MEDIA';
  readonly estadosSeleccionados = new Map<number, EstadoIncidencia>();
  cargando = true;
  guardando = false;
  guardandoEstadoId: number | null = null;
  soloPendientes = true;
  error = '';
  mensaje = '';

  constructor(private readonly practicaService: PracticaService, private readonly router: Router) {}

  ngOnInit(): void {
    this.fecha = this.fechaHoy();
    this.cargar();
  }

  private fechaHoy(): string {
    const hoy = new Date();
    return [hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate()]
      .map((parte, indice) => indice === 0 ? String(parte) : String(parte).padStart(2, '0'))
      .join('-');
  }

  cargar(): void {
    this.cargando = true;
    this.error = '';
    forkJoin({
      practicas: this.practicaService.listarPracticasParaGestion(),
      incidencias: this.practicaService.listarIncidencias()
    }).subscribe({
      next: ({ practicas, incidencias }) => {
        this.practicas = practicas.filter(practica => !practica.es_final);
        this.incidencias = incidencias;
        incidencias.forEach(item => this.estadosSeleccionados.set(item.id_incidencia, item.estado));
        this.practicaSeleccionada ??= this.practicas[0]?.id_practica ?? null;
        this.cargando = false;
      },
      error: () => {
        this.error = 'No fue posible cargar las prácticas y sus incidencias.';
        this.cargando = false;
      }
    });
  }

  incidenciasVisibles(): IncidenciaPractica[] {
    return this.incidencias.filter(item =>
      !this.soloPendientes || item.estado === 'ABIERTA' || item.estado === 'EN_REVISION'
    );
  }

  pendientes(): number {
    return this.incidencias.filter(item => item.estado === 'ABIERTA' || item.estado === 'EN_REVISION').length;
  }

  registrar(): void {
    if (this.practicaSeleccionada === null || !this.descripcion.trim()) {
      this.error = 'Selecciona una práctica e ingresa la descripción de la incidencia.';
      return;
    }
    this.error = '';
    this.guardando = true;
    this.practicaService.registrarIncidencia(
      this.practicaSeleccionada,
      this.fecha,
      this.descripcion.trim(),
      this.prioridad
    ).subscribe({
      next: incidencia => {
        this.incidencias = [incidencia, ...this.incidencias];
        this.estadosSeleccionados.set(incidencia.id_incidencia, incidencia.estado);
        this.descripcion = '';
        this.guardando = false;
        this.mensaje = incidencia.alerta
          ? 'Incidencia registrada y alerta generada por su prioridad.'
          : 'Incidencia registrada.';
        window.setTimeout(() => this.mensaje = '', 5000);
      },
      error: (respuesta: HttpErrorResponse) => {
        this.guardando = false;
        this.error = respuesta.error?.detail ?? 'No fue posible registrar la incidencia.';
      }
    });
  }

  guardarEstado(incidencia: IncidenciaPractica): void {
    const estado = this.estadosSeleccionados.get(incidencia.id_incidencia);
    if (!estado || estado === incidencia.estado) return;
    this.guardandoEstadoId = incidencia.id_incidencia;
    this.error = '';
    this.practicaService.actualizarEstadoIncidencia(incidencia.id_incidencia, estado).subscribe({
      next: respuesta => {
        this.incidencias = this.incidencias.map(item => item.id_incidencia === respuesta.id_incidencia
          ? { ...item, estado: respuesta.estado, fecha_resolucion: ['RESUELTA', 'CERRADA'].includes(respuesta.estado) ? new Date().toISOString() : null }
          : item);
        this.guardandoEstadoId = null;
        this.mensaje = respuesta.mensaje;
        window.setTimeout(() => this.mensaje = '', 5000);
      },
      error: (respuesta: HttpErrorResponse) => {
        this.estadosSeleccionados.set(incidencia.id_incidencia, incidencia.estado);
        this.guardandoEstadoId = null;
        this.error = respuesta.error?.detail ?? 'No fue posible actualizar el estado de la incidencia.';
      }
    });
  }

  volver(): void {
    this.router.navigate(['/home']);
  }
}
