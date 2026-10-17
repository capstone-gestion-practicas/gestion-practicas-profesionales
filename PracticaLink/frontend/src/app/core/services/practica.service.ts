import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  PracticaDetalleResponse,
  PracticaDetalleGestionResponse,
  PracticasListadoResponse,
  PracticaCreate,
  PracticaCreateResponse,
  EmpresaLookup
} from '../models/practica.models';

@Injectable({ providedIn: 'root' })
export class PracticaService {
  private readonly apiUrl = 'http://127.0.0.1:8000';

  constructor(private readonly http: HttpClient) {}

  listar(limit = 50, offset = 0, rut?: string): Observable<PracticasListadoResponse> {
    let params = new HttpParams().set('limit', limit).set('offset', offset);
    if (rut) {
      params = params.set('rut', rut);
    }
    return this.http.get<PracticasListadoResponse>(`${this.apiUrl}/practicas`, { params });
  }

  obtenerDetalle(idPractica: string): Observable<PracticaDetalleGestionResponse> {
    return this.http.get<PracticaDetalleGestionResponse>(
      `${this.apiUrl}/practicas/${encodeURIComponent(idPractica)}`
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
