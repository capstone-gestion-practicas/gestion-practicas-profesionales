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
  IonRow,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea
} from '@ionic/angular';

import {
  IncidenciaPractica,
  PracticaEstadoResumen
} from '../../core/models/practica.models';
import { TIPOS_INCIDENCIA, TipoIncidencia } from '../../core/models/incidencia.models';
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
  practicas: PracticaEstadoResumen[] = [];
  incidencias: IncidenciaPractica[] = [];
  practicaSeleccionada: number | null = null;
  readonly tipos = TIPOS_INCIDENCIA;
  tipo: TipoIncidencia | null = null;
  descripcion = '';
  cargando = true;
  guardando = false;
  soloPendientes = true;
  error = '';
  mensaje = '';

  constructor(private readonly practicaService: PracticaService, private readonly router: Router) {}

  ngOnInit(): void {
    this.cargar();
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
        this.practicaSeleccionada ??= this.practicas[0]?.id_practica ?? null;
        this.cargando = false;
      },
      error: () => {
        this.error = 'No fue posible cargar las prácticas y sus incidencias.';
        this.cargando = false;
      }
    });
  }

  // Pendiente = cualquier estado no cerrado. Cubre PENDIENTE/EN_ATENCION (EP06) y ABIERTA/EN_REVISION (legado).
  esPendiente(item: IncidenciaPractica): boolean {
    return item.estado !== 'RESUELTA' && item.estado !== 'CERRADA';
  }

  incidenciasVisibles(): IncidenciaPractica[] {
    return this.incidencias.filter(item => !this.soloPendientes || this.esPendiente(item));
  }

  pendientes(): number {
    return this.incidencias.filter(item => this.esPendiente(item)).length;
  }

  registrar(): void {
    if (this.practicaSeleccionada === null || this.tipo === null || !this.descripcion.trim()) {
      this.error = 'Selecciona una práctica, un tipo e ingresa la descripción de la incidencia.';
      return;
    }
    this.error = '';
    this.guardando = true;
    // Contrato EP06 exclusivo: tipo y descripcion. Sin fecha ni prioridad.
    this.practicaService.registrarIncidencia(String(this.practicaSeleccionada), {
      tipo: this.tipo,
      descripcion: this.descripcion.trim()
    }).subscribe({
      next: () => {
        this.descripcion = '';
        this.tipo = null;
        this.guardando = false;
        this.mensaje = 'Incidencia registrada.';
        window.setTimeout(() => this.mensaje = '', 5000);
        // La lista legado tiene otra forma: se recarga en lugar de insertar la respuesta EP06.
        this.cargar();
      },
      error: (respuesta: HttpErrorResponse) => {
        this.guardando = false;
        this.error = respuesta.error?.detail ?? 'No fue posible registrar la incidencia.';
      }
    });
  }

  volver(): void {
    this.router.navigate(['/home']);
  }
}
