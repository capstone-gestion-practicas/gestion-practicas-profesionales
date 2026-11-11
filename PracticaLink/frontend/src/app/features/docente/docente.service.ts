import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface DocenteDisponible { id_usuario: number; nombre: string; correo: string; }
export interface AsignacionDocenteDetalle {
  id_practica: number;
  docente_actual: DocenteDisponible | null;
  docentes_disponibles: DocenteDisponible[];
}

export interface AsignacionDocenteResultado {
  id_practica: number;
  id_docente: number | null;
  id_docente_anterior: number | null;
  mensaje: string;
}

export interface PracticaDocente {
  id_practica: number;
  estado: string;
  estudiante: string;
  centro_practica: string;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  cargo_funcion: string | null;
  descripcion: string | null;
  informe_estado: 'ENTREGADO' | 'EN_EVALUACION' | null;
  informe_version: number | null;
  evaluacion_resultado: 'APROBADO' | 'CON_OBSERVACIONES' | null;
}

@Injectable({ providedIn: 'root' })
export class DocenteService {
  private readonly api = environment.apiUrl;
  constructor(private readonly http: HttpClient) {}
  listar(): Observable<PracticaDocente[]> {
    return this.http.get<PracticaDocente[]>(`${this.api}/docente/practicas`);
  }
  consultarAsignacion(idPractica: number): Observable<AsignacionDocenteDetalle> {
    return this.http.get<AsignacionDocenteDetalle>(`${this.api}/docente/practicas/${idPractica}/asignacion`);
  }
  asignar(idPractica: number, idDocente: number | null, motivo: string | null): Observable<AsignacionDocenteResultado> {
    return this.http.put<AsignacionDocenteResultado>(`${this.api}/docente/practicas/${idPractica}/asignacion`, { id_docente: idDocente, motivo });
  }
  obtener(id: string): Observable<PracticaDocente> {
    return this.http.get<PracticaDocente>(`${this.api}/docente/practicas/${encodeURIComponent(id)}`);
  }
}
