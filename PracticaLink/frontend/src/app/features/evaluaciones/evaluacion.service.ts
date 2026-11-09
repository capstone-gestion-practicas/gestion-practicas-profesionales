import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export type ResultadoAcademico = 'APROBADO' | 'CON_OBSERVACIONES';
export interface Evaluacion {
  id_evaluacion: string;
  id_practica: number;
  id_documento: number;
  version: number;
  id_docente: number;
  estado: 'EN_CURSO' | 'RESUELTA' | 'INTERRUMPIDA';
  resultado: ResultadoAcademico | null;
  observaciones: string | null;
  motivo: string | null;
  inicio: string;
  termino: string | null;
}
export interface EventoAcademico {
  id_evento: number;
  id_evaluacion: string;
  id_actor: number;
  tipo: 'INICIADA' | 'RESUELTA' | 'INTERRUMPIDA';
  fecha: string;
  detalle: string | null;
}
export interface EstadoAcademico {
  id_practica: number;
  id_documento: number | null;
  version: number;
  estado_informe: 'SIN_ENTREGAR' | 'ENTREGADO' | 'EN_EVALUACION';
  evaluacion_pendiente: Evaluacion | null;
  resultado_vigente: Evaluacion | null;
}
export interface ConsultaAcademica extends EstadoAcademico {
  historial: (Evaluacion & { eventos: EventoAcademico[] })[];
}
export interface ResolucionAcademica {
  resultado: ResultadoAcademico;
  observaciones: string | null;
}
// Ayuda visual: la decisión definitiva y las demás condiciones siguen en PostgreSQL.
export function aprobacionVigente(estado: EstadoAcademico | null | undefined): boolean {
  const resultado = estado?.resultado_vigente;
  return !!estado?.id_documento && estado.estado_informe === 'ENTREGADO' && !estado.evaluacion_pendiente
    && resultado?.estado === 'RESUELTA' && resultado.resultado === 'APROBADO'
    && resultado.id_practica === estado.id_practica && resultado.id_documento === estado.id_documento && resultado.version === estado.version;
}
@Injectable({ providedIn: 'root' })
export class EvaluacionService {
  private readonly http = inject(HttpClient);
  private ruta(id: number): string { return `${environment.apiUrl}/practicas/${id}/evaluaciones`; }
  consultar(id: number) { return this.http.get<ConsultaAcademica>(this.ruta(id)); }
  vigente(id: number) { return this.http.get<EstadoAcademico>(`${this.ruta(id)}/vigente`); }
  iniciar(id: number, documento: number, version: number, key: string) {
    return this.http.post<Evaluacion>(`${this.ruta(id)}/inicio`,
      { id_documento: documento, version }, { headers: { 'Idempotency-Key': key } });
  }
  resolver(id: number, evaluacion: string, datos: ResolucionAcademica, key: string) {
    return this.http.post<Evaluacion>(`${this.ruta(id)}/${evaluacion}/resolucion`, datos,
      { headers: { 'Idempotency-Key': key } });
  }
}
