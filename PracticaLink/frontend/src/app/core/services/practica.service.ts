import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

import {
  PracticaDetalleResponse,
  PracticaCreate,
  PracticaCreateResponse,
  EmpresaLookup,
  EstudianteSinPractica,
  EstadoPracticaDetalle,
  HistorialEstadoPractica,
  PracticaEstadoResumen,
  ActualizarEstadoPracticaResponse,
  AsignarGestorPracticaResponse,
  CerrarPracticaResponse,
  GestorPractica,
  IniciarPracticaResponse,
  SeguimientoPractica,
  IncidenciaPractica,
  EstadoIncidencia,
  ActualizarEstadoIncidenciaResponse,
  RecordatorioEstudianteResponse
} from '../models/practica.models';

@Injectable({ providedIn: 'root' })
export class PracticaService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  registrar(datos: PracticaCreate): Observable<PracticaCreateResponse> {
    return this.http.post<PracticaCreateResponse>(
      `${this.apiUrl}/practicas`,
      datos
    );
  }

  consultarEmpresa(rut: string): Observable<EmpresaLookup> {
    return this.http.get<EmpresaLookup>(
      `${this.apiUrl}/empresas/consulta/${encodeURIComponent(rut)}`
    );
  }

  obtenerMiPractica(): Observable<PracticaDetalleResponse> {
    return this.http.get<PracticaDetalleResponse>(`${this.apiUrl}/practicas/me`);
  }

  listarEstados(): Observable<EstadoPracticaDetalle[]> {
    return this.http.get<EstadoPracticaDetalle[]>(`${this.apiUrl}/practicas/estados`);
  }

  listarPracticasParaGestion(): Observable<PracticaEstadoResumen[]> {
    return this.http.get<PracticaEstadoResumen[]>(`${this.apiUrl}/practicas/gestion-estados`);
  }

  listarGestores(): Observable<GestorPractica[]> {
    return this.http.get<GestorPractica[]>(`${this.apiUrl}/practicas/gestores`);
  }

  asignarGestor(
    idPractica: number,
    idGestor: number | null
  ): Observable<AsignarGestorPracticaResponse> {
    return this.http.patch<AsignarGestorPracticaResponse>(
      `${this.apiUrl}/practicas/${idPractica}/gestor`,
      { id_gestor: idGestor }
    );
  }

  cerrarPractica(
    idPractica: number,
    observacion: string | null
  ): Observable<CerrarPracticaResponse> {
    return this.http.post<CerrarPracticaResponse>(
      `${this.apiUrl}/practicas/${idPractica}/cierre`,
      { observacion }
    );
  }

  listarEstudiantesSinPractica(): Observable<EstudianteSinPractica[]> {
    return this.http.get<EstudianteSinPractica[]>(
      `${this.apiUrl}/practicas/estudiantes-sin-practica`
    );
  }

  enviarRecordatorioEstudiante(idUsuario: number): Observable<RecordatorioEstudianteResponse> {
    return this.http.post<RecordatorioEstudianteResponse>(
      `${this.apiUrl}/practicas/estudiantes/${idUsuario}/recordatorio`,
      {}
    );
  }

  obtenerHistorialEstados(idPractica: number): Observable<HistorialEstadoPractica[]> {
    return this.http.get<HistorialEstadoPractica[]>(
      `${this.apiUrl}/practicas/${idPractica}/historial-estados`
    );
  }

  actualizarEstado(
    idPractica: number,
    idEstado: number,
    observacion: string | null
  ): Observable<ActualizarEstadoPracticaResponse> {
    return this.http.patch<ActualizarEstadoPracticaResponse>(
      `${this.apiUrl}/practicas/${idPractica}/estado/actualizacion`,
      { id_estado: idEstado, observacion }
    );
  }

  iniciarPractica(
    idPractica: number,
    observacion: string | null
  ): Observable<IniciarPracticaResponse> {
    return this.http.patch<IniciarPracticaResponse>(
      `${this.apiUrl}/practicas/${idPractica}/estado`,
      { estado: 'EN_CURSO', observacion }
    );
  }

  responderObservacion(idPractica: number, respuesta: string): Observable<ActualizarEstadoPracticaResponse> {
    return this.http.patch<ActualizarEstadoPracticaResponse>(
      `${this.apiUrl}/practicas/${idPractica}/respuesta-observacion`,
      { respuesta }
    );
  }

  listarSeguimientos(idPractica: number): Observable<SeguimientoPractica[]> {
    return this.http.get<SeguimientoPractica[]>(
      `${this.apiUrl}/practicas/${idPractica}/seguimientos`
    );
  }

  registrarSeguimiento(
    idPractica: number,
    fecha: string,
    observacion: string
  ): Observable<SeguimientoPractica> {
    return this.http.post<SeguimientoPractica>(
      `${this.apiUrl}/practicas/${idPractica}/seguimientos`,
      { fecha, observacion }
    );
  }

  listarIncidencias(): Observable<IncidenciaPractica[]> {
    return this.http.get<IncidenciaPractica[]>(`${this.apiUrl}/incidencias`);
  }

  registrarIncidencia(
    idPractica: number,
    fecha: string,
    descripcion: string,
    prioridad: IncidenciaPractica['prioridad']
  ): Observable<IncidenciaPractica> {
    return this.http.post<IncidenciaPractica>(
      `${this.apiUrl}/practicas/${idPractica}/incidencias`,
      { fecha, descripcion, prioridad }
    );
  }

  actualizarEstadoIncidencia(
    idIncidencia: number,
    estado: EstadoIncidencia
  ): Observable<ActualizarEstadoIncidenciaResponse> {
    return this.http.patch<ActualizarEstadoIncidenciaResponse>(
      `${this.apiUrl}/incidencias/${idIncidencia}/estado`,
      { estado }
    );
  }
}
