import { InformeFinal } from '../informe-final/informe-final';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonButton, IonSpinner } from '@ionic/angular';
import { DocenteService, PracticaDocente } from './docente.service';
import { formatearFechaCalendario } from '../../core/utils/fechas';

/** Insignia visible del estado del informe, derivada de la evaluación vigente. */
export interface InsigniaInforme {
  texto: string;
  tono: 'info' | 'warning' | 'success' | 'neutral' | 'danger';
}

@Component({
  standalone: true, selector: 'app-docente-practicas',
  imports: [CommonModule, RouterLink, IonButton, IonSpinner, InformeFinal],
  templateUrl: './docente-practicas.html', styleUrl: './docente-practicas.scss'
})
export class DocentePracticas implements OnInit {
  private readonly api = inject(DocenteService);
  private readonly route = inject(ActivatedRoute);
  practica: PracticaDocente | null = null;
  practicas: PracticaDocente[] = [];
  filtro: 'todas' | 'por_evaluar' = 'todas';
  cargando = true;
  error = '';
  esDetalle = false;

  /** dd/MM/yyyy sin desplazamiento de zona horaria; conserva el texto para fechas nulas. */
  fechaCalendario(fecha: string | null): string {
    return fecha ? formatearFechaCalendario(fecha) : 'Sin fecha registrada';
  }

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.esDetalle = id !== null;
    this.cargando = true;
    this.error = '';

    if (id !== null) {
      this.api.obtener(id).subscribe({
        next: (practica: PracticaDocente) => {
          this.practica = practica;
          this.cargando = false;
        },
        error: (error: HttpErrorResponse) => this.manejarError(error)
      });
      return;
    }

    this.api.listar().subscribe({
      next: (practicas: PracticaDocente[]) => {
        this.practicas = practicas;
        this.cargando = false;
      },
      error: (error: HttpErrorResponse) => this.manejarError(error)
    });
  }

  /** «Por evaluar»: informe entregado y sin resultado académico para la versión vigente. */
  esPorEvaluar(practica: PracticaDocente): boolean {
    return practica.informe_estado !== null && practica.evaluacion_resultado === null;
  }

  get practicasVisibles(): PracticaDocente[] {
    return this.filtro === 'por_evaluar' ? this.practicas.filter(p => this.esPorEvaluar(p)) : this.practicas;
  }

  get totalPorEvaluar(): number {
    return this.practicas.filter(p => this.esPorEvaluar(p)).length;
  }

  insigniaInforme(practica: PracticaDocente): InsigniaInforme {
    if (practica.informe_estado === null) return { texto: 'Informe aún no entregado', tono: 'neutral' };
    if (practica.evaluacion_resultado === 'APROBADO') return { texto: 'Informe aprobado', tono: 'success' };
    if (practica.evaluacion_resultado === 'CON_OBSERVACIONES') return { texto: 'Evaluación con observaciones', tono: 'warning' };
    if (practica.informe_estado === 'EN_EVALUACION') return { texto: 'Evaluación en curso', tono: 'warning' };
    return { texto: `Informe v${practica.informe_version} entregado · por evaluar`, tono: 'warning' };
  }

  inicialEstudiante(nombre: string): string {
    return nombre.trim().charAt(0).toUpperCase() || '?';
  }

  private manejarError(error: HttpErrorResponse): void {
    this.error = error.status === 404 ? 'La práctica no está asignada a esta cuenta.'
      : error.status === 403 ? 'Tu cuenta no tiene un rol DOCENTE activo.'
      : 'No fue posible cargar las prácticas. Intenta nuevamente.';
    this.cargando = false;
  }
}
