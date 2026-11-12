import { CommonModule } from '@angular/common';
import { SupervisionAdmin } from '../../features/administrador/supervision-admin';
import { OperacionAcademica } from '../../features/administrador/operacion-academica';
import { muestraEspacioAdministrador } from '../../core/navigation/espacio-administrador';
import { Component, OnInit, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/store/auth.store';
import { esEspacioGestorDedicado } from '../../core/navigation/espacio-gestor';
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
import { muestraEspacioGestor } from '../../core/navigation/espacio-gestor';
import { PESTANAS_ACOMPANAMIENTO, PestanasGestor } from '../../features/gestor/pestanas/pestanas-gestor';

@Component({
  selector: 'app-incidencias',
  standalone: true,
  imports: [
    CommonModule,
    SupervisionAdmin, OperacionAcademica,
    PestanasGestor,
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
  get espacioAdmin(): boolean { return muestraEspacioAdministrador(this.authStore.contexto()); }
  get espacioGestor(): boolean { return muestraEspacioGestor(this.authStore.contexto()); }
  private practicasConsultables = new Set<number>();
  puedeConsultar(id: number): boolean { return this.practicasConsultables.has(id); }
  abrirDetalle(id: number): void {
    if (!this.puedeConsultar(id)) return;
    void this.router.navigate(['/practicas', id], { queryParams: { vista: 'incidencias' } });
  }
  abrirRegistro(): void {
    if (!this.puedeRegistrar() || this.practicaSeleccionada === null) return;
    void this.router.navigate(['/practicas', this.practicaSeleccionada, 'incidencias', 'nueva']);
  }
  private readonly authStore = inject(AuthStore);
  practicas: PracticaEstadoResumen[] = [];
  incidencias: IncidenciaPractica[] = [];
  practicaSeleccionada: number | null = null;
  readonly tipos = TIPOS_INCIDENCIA;
  readonly pestanas = PESTANAS_ACOMPANAMIENTO;
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
        this.practicasConsultables = new Set(practicas.map(p => p.id_practica));
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
  /** Las incidencias solo se registran con la práctica seleccionada EN_CURSO (la BD también lo exige). */
  puedeRegistrar(): boolean {
    const seleccionada = this.practicas.find(practica => practica.id_practica === this.practicaSeleccionada);
    return seleccionada?.estado.toUpperCase() === 'EN_CURSO';
  }

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
    if (!this.puedeRegistrar()) {
      this.error = 'Las incidencias se registran cuando la práctica está en curso.';
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

  mostrarVolver(): boolean {
    return !esEspacioGestorDedicado(this.authStore.obtenerContextoActual());
  }

  volver(): void {
    this.router.navigate(['/home']);
  }
}
