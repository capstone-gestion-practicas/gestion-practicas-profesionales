import { Injectable, inject, signal } from '@angular/core';

import { RevisionService } from './revision.service';

/** Estados que cuentan como «por revisar» en el espacio de gestión. */
export function esPorRevisar(estado: string): boolean {
  return ['REGISTRADA', 'EN_REVISION'].includes(estado.trim().toUpperCase());
}

/**
 * Fuente única del contador de solicitudes por revisar. Usa el mismo listado que el
 * espacio de gestión; evita consultas simultáneas y no publica cifras si la carga falla.
 */
@Injectable({ providedIn: 'root' })
export class SolicitudesPendientesService {
  private readonly revisionService = inject(RevisionService);
  private enCurso = false;

  /** null mientras no hay dato real: la interfaz no muestra cifras inventadas. */
  readonly total = signal<number | null>(null);

  refrescar(): void {
    if (this.enCurso) return;
    this.enCurso = true;
    this.revisionService.listar().subscribe({
      next: solicitudes => {
        this.total.set(solicitudes.filter(solicitud => esPorRevisar(solicitud.estado)).length);
        this.enCurso = false;
      },
      error: () => {
        this.total.set(null);
        this.enCurso = false;
      }
    });
  }
}
