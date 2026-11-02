import { IncidenciaEstadoRequest, IncidenciaEstadoResponse, IncidenciaEstadosHistorialResponse, IncidenciaCreate, IncidenciaResponse, IncidenciasHistorialResponse } from '../models/incidencia.models';
import { SeguimientoCreate, SeguimientoResponse, SeguimientosHistorialResponse } from '../models/seguimiento.models';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  PracticaDetalleResponse,
  PracticaDetalleGestionResponse,
  HistorialPracticaResponse,
  PracticasListadoResponse,
  ResumenIncidenciasPendientesResponse,
  PracticaCreate,
  PracticaCreateResponse,
  EmpresaLookup,
  IniciarPracticaRequest,
  IniciarPracticaResponse
} from '../models/practica.models';

@Injectable({ providedIn: 'root' })
export class PracticaService {
  private readonly apiUrl = 'http://127.0.0.1:8000';

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

  listar(limit = 50, offset = 0, rut?: string): Observable<PracticasListadoResponse> {
    let params = new HttpParams().set('limit', limit).set('offset', offset);
    if (rut) {
      params = params.set('rut', rut);
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
}
