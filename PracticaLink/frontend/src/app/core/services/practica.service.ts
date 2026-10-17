import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

import {
  PracticaDetalleResponse,
  PracticaCreate,
  PracticaCreateResponse,
  EmpresaLookup,
  EstadoPracticaDetalle,
  HistorialEstadoPractica,
  PracticaEstadoResumen,
  ActualizarEstadoPracticaResponse
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
      `${this.apiUrl}/practicas/${idPractica}/estado`,
      { id_estado: idEstado, observacion }
    );
  }

  responderObservacion(idPractica: number, respuesta: string): Observable<ActualizarEstadoPracticaResponse> {
    return this.http.patch<ActualizarEstadoPracticaResponse>(
      `${this.apiUrl}/practicas/${idPractica}/respuesta-observacion`,
      { respuesta }
    );
  }
}
