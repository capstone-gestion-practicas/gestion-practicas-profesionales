import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
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

import { PracticaEstadoResumen } from '../../core/models/practica.models';
import {
  fechaSeguimientoValida,
  MEDIOS_CONTACTO,
  SeguimientoCreate,
  SeguimientoHistorialItem
} from '../../core/models/seguimiento.models';
import { PracticaService } from '../../core/services/practica.service';

@Component({
  selector: 'app-seguimientos',
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
  templateUrl: './seguimientos.html',
  styleUrl: './seguimientos.scss'
})
export class Seguimientos implements OnInit {
  practicas: PracticaEstadoResumen[] = [];
  readonly medios = MEDIOS_CONTACTO;
  readonly historiales = new Map<number, SeguimientoHistorialItem[]>();
  readonly fechas = new Map<number, string>();
  readonly tipos = new Map<number, string>();
  readonly observaciones = new Map<number, string>();
  cargando = true;
  guardandoId: number | null = null;
  historialAbiertoId: number | null = null;
  cargandoHistorialId: number | null = null;
  error = '';
  errorHistorial = '';
  mensaje = '';

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
    this.practicaService.listarPracticasParaGestion().subscribe({
      next: practicas => {
        this.practicas = practicas;
        this.practicas.forEach(practica => this.prepararFormulario(practica.id_practica));
        this.cargando = false;
      },
      error: () => {
        this.error = 'No fue posible cargar las prácticas para seguimiento.';
        this.cargando = false;
      }
    });
  }

  private prepararFormulario(idPractica: number): void {
    if (!this.fechas.has(idPractica)) {
      const hoy = new Date();
      this.fechas.set(idPractica, [hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate()]
        .map((parte, indice) => indice === 0 ? String(parte) : String(parte).padStart(2, '0'))
        .join('-'));
    }
  }

  registrar(practica: PracticaEstadoResumen): void {
    const id = practica.id_practica;
    const observacion = this.observaciones.get(id)?.trim() ?? '';
    const fecha = this.fechas.get(id) ?? '';
    const tipo = this.tipos.get(id) ?? '';
    if (!fechaSeguimientoValida(fecha)) {
      this.error = 'Indica una fecha válida, no futura, para el seguimiento.';
      return;
    }
    if (!tipo) {
      this.error = 'Selecciona el medio de contacto antes de guardar el seguimiento.';
      return;
    }
    if (!observacion) {
      this.error = 'Escribe una observación antes de guardar el seguimiento.';
      return;
    }
    this.error = '';
    this.guardandoId = id;
    const datos: SeguimientoCreate = { fecha, tipo: tipo as SeguimientoCreate['tipo'], observacion };
    this.practicaService.registrarSeguimiento(String(id), datos).subscribe({
      next: () => {
        this.observaciones.set(id, '');
        this.tipos.set(id, '');
        this.guardandoId = null;
        this.mensaje = `Seguimiento registrado para ${practica.estudiante}.`;
        window.setTimeout(() => this.mensaje = '', 5000);
        // Recargar desde el servidor: la respuesta de alta no incluye el nombre del responsable.
        this.historiales.delete(id);
        if (this.historialAbiertoId === id) {
          this.cargarHistorial(id);
        }
      },
      error: (respuesta: HttpErrorResponse) => {
        this.guardandoId = null;
        this.error = respuesta.error?.detail ?? 'No fue posible registrar el seguimiento.';
      }
    });
  }

  alternarHistorial(practica: PracticaEstadoResumen): void {
    const id = practica.id_practica;
    if (this.historialAbiertoId === id) {
      this.historialAbiertoId = null;
      return;
    }
    this.historialAbiertoId = id;
    this.errorHistorial = '';
    if (this.historiales.has(id)) return;
    this.cargarHistorial(id);
  }

  private cargarHistorial(id: number): void {
    this.cargandoHistorialId = id;
    this.practicaService.obtenerSeguimientos(String(id)).subscribe({
      next: respuesta => {
        this.historiales.set(id, respuesta.items);
        this.cargandoHistorialId = null;
      },
      error: () => {
        this.errorHistorial = 'No fue posible cargar el historial de esta práctica.';
        this.cargandoHistorialId = null;
      }
    });
  }

  historialDe(idPractica: number): SeguimientoHistorialItem[] {
    return this.historiales.get(idPractica) ?? [];
  }

  volver(): void {
    this.router.navigate(['/home']);
  }
}
