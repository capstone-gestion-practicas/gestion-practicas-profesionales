import { IncidenciaEstadoRequest, IncidenciaEstadoResponse, IncidenciaEstadosHistorialResponse, IncidenciaCreate, IncidenciaResponse, IncidenciasHistorialResponse } from '../models/incidencia.models';
import { SeguimientoCreate, SeguimientoResponse, SeguimientosHistorialResponse } from '../models/seguimiento.models';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

import {
  PracticaDetalleResponse,
  PracticaDetalleGestionResponse,
  HistorialPracticaResponse,
  PracticasListadoResponse,
  ResumenIncidenciasPendientesResponse,
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
  IniciarPracticaRequest,
  IniciarPracticaResponse,
  IncidenciaPractica,
  RecordatorioEstudianteResponse
} from '../models/practica.models';

@Injectable({ providedIn: 'root' })
export class PracticaService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  obtenerSeguimientos(idPractica: string, limit = 50, offset = 0): Observable<SeguimientosHistorialResponse> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<SeguimientosHistorialResponse>(
      `${this.apiUrl}/practicas/${encodeURIComponent(idPractica)}/seguimientos`, { params }
    );
  }

  registrarSeguimiento(idPractica: string, datos: SeguimientoCreate): Observable<HttpResponse<SeguimientoResponse>> {
    const { fecha, tipo, observacion } = datos;
    return this.http.post<SeguimientoResponse>(
      `${this.apiUrl}/practicas/${encodeURIComponent(idPractica)}/seguimientos`,
      { fecha, tipo, observacion }, { observe: 'response' }
    );
  }

  cambiarEstadoIncidencia(idPractica: string, idIncidencia: string, datos: IncidenciaEstadoRequest): Observable<HttpResponse<IncidenciaEstadoResponse>> {
    const { estado_esperado, estado_nuevo, comentario } = datos;
    return this.http.patch<IncidenciaEstadoResponse>(
      `${this.apiUrl}/practicas/${encodeURIComponent(idPractica)}/incidencias/${encodeURIComponent(idIncidencia)}/estado`,
      { estado_esperado, estado_nuevo, comentario }, { observe: 'response' }
    );
  }

  obtenerHistorialIncidencia(idPractica: string, idIncidencia: string, limit = 50, offset = 0): Observable<IncidenciaEstadosHistorialResponse> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<IncidenciaEstadosHistorialResponse>(
      `${this.apiUrl}/practicas/${encodeURIComponent(idPractica)}/incidencias/${encodeURIComponent(idIncidencia)}/historial`, { params }
    );
  }

  obtenerIncidencias(idPractica: string, limit = 50, offset = 0): Observable<IncidenciasHistorialResponse> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<IncidenciasHistorialResponse>(
      `${this.apiUrl}/practicas/${encodeURIComponent(idPractica)}/incidencias`, { params }
    );
  }

  registrarIncidencia(idPractica: string, datos: IncidenciaCreate): Observable<HttpResponse<IncidenciaResponse>> {
    const { tipo, descripcion } = datos;
    return this.http.post<IncidenciaResponse>(
      `${this.apiUrl}/practicas/${encodeURIComponent(idPractica)}/incidencias`,
      { tipo, descripcion }, { observe: 'response' }
    );
  }

  // estado filtra en el servidor (GET /practicas?estado=...) antes de paginar; etapa 4a/4b.
  listar(limit = 50, offset = 0, rut?: string, estado?: string): Observable<PracticasListadoResponse> {
    let params = new HttpParams().set('limit', limit).set('offset', offset);
    if (rut) {
      params = params.set('rut', rut);
    }
    if (estado) {
      params = params.set('estado', estado);
    }
    return this.http.get<PracticasListadoResponse>(`${this.apiUrl}/practicas`, { params });
  }

  // Solo paginación: sin id_usuario, roles ni filtros. Identidad desde el JWT.
  obtenerResumenIncidenciasPendientes(limit = 100, offset = 0): Observable<ResumenIncidenciasPendientesResponse> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<ResumenIncidenciasPendientesResponse>(
      `${this.apiUrl}/practicas/con-incidencias-pendientes`, { params }
    );
  }

  obtenerDetalle(idPractica: string): Observable<PracticaDetalleGestionResponse> {
    return this.http.get<PracticaDetalleGestionResponse>(
      `${this.apiUrl}/practicas/${encodeURIComponent(idPractica)}`
    );
  }

  iniciar(idPractica: string, datos: IniciarPracticaRequest): Observable<IniciarPracticaResponse> {
    return this.http.patch<IniciarPracticaResponse>(
      `${this.apiUrl}/practicas/${encodeURIComponent(idPractica)}/estado`, datos
    );
  }

  obtenerHistorial(idPractica: string, limit = 50, offset = 0): Observable<HistorialPracticaResponse> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<HistorialPracticaResponse>(
      `${this.apiUrl}/practicas/${encodeURIComponent(idPractica)}/historial`, { params }
    );
  }

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

  listarIncidencias(): Observable<IncidenciaPractica[]> {
    return this.http.get<IncidenciaPractica[]>(`${this.apiUrl}/incidencias`);
  }
}
