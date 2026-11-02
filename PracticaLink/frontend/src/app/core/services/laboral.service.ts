import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  HistorialPostulacion,
  CuentaEmpresa,
  OfertaGuardada,
  OfertaLaboral,
  OfertaLaboralInput,
  OperacionPostulacion,
  PostulacionEmpresa,
  PostulacionEstudiante,
  PracticaEmpresa,
  EstadoPostulacion,
  ResolverSolicitudCuentaEmpresa,
  SolicitudCuentaEmpresa,
  SolicitudCuentaEmpresaCreada,
  SolicitudCuentaEmpresaInput,
  SolicitudCuentaEmpresaResuelta
} from '../models/laboral.models';
import { EmpresaLookup } from '../models/practica.models';

@Injectable({ providedIn: 'root' })
export class LaboralService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/laboral`;

  listarOfertasPublicadas(): Observable<OfertaLaboral[]> {
    return this.http.get<OfertaLaboral[]>(`${this.apiUrl}/ofertas`);
  }

  consultarEmpresa(rut: string): Observable<EmpresaLookup> {
    return this.http.get<EmpresaLookup>(
      `${environment.apiUrl}/empresas/consulta/${encodeURIComponent(rut)}`
    );
  }

  listarOfertasGestion(): Observable<OfertaLaboral[]> {
    return this.http.get<OfertaLaboral[]>(`${this.apiUrl}/ofertas/gestion`);
  }

  obtenerOferta(idOferta: number): Observable<OfertaLaboral> {
    return this.http.get<OfertaLaboral>(`${this.apiUrl}/ofertas/${idOferta}`);
  }

  guardarOferta(datos: OfertaLaboralInput, idOferta?: number): Observable<OfertaGuardada> {
    return idOferta
      ? this.http.put<OfertaGuardada>(`${this.apiUrl}/ofertas/${idOferta}`, datos)
      : this.http.post<OfertaGuardada>(`${this.apiUrl}/ofertas`, datos);
  }

  listarPracticasEmpresa(): Observable<PracticaEmpresa[]> {
    return this.http.get<PracticaEmpresa[]>(`${this.apiUrl}/practicas`);
  }

  obtenerCuentaEmpresa(): Observable<CuentaEmpresa> {
    return this.http.get<CuentaEmpresa>(`${this.apiUrl}/empresa/cuenta`);
  }

  postular(idOferta: number, cartaPresentacion: string | null): Observable<OperacionPostulacion> {
    return this.http.post<OperacionPostulacion>(
      `${this.apiUrl}/ofertas/${idOferta}/postulaciones`,
      { carta_presentacion: cartaPresentacion }
    );
  }

  listarMisPostulaciones(): Observable<PostulacionEstudiante[]> {
    return this.http.get<PostulacionEstudiante[]>(`${this.apiUrl}/postulaciones/mias`);
  }

  listarPostulaciones(idOferta: number): Observable<PostulacionEmpresa[]> {
    return this.http.get<PostulacionEmpresa[]>(
      `${this.apiUrl}/ofertas/${idOferta}/postulaciones`
    );
  }

  actualizarPostulacion(
    idPostulacion: number,
    estado: EstadoPostulacion,
    observacion: string | null = null
  ): Observable<OperacionPostulacion> {
    return this.http.patch<OperacionPostulacion>(
      `${this.apiUrl}/postulaciones/${idPostulacion}`,
      { estado, observacion }
    );
  }

  historialPostulacion(idPostulacion: number): Observable<HistorialPostulacion[]> {
    return this.http.get<HistorialPostulacion[]>(
      `${this.apiUrl}/postulaciones/${idPostulacion}/historial`
    );
  }

  consultarEmpresaParaSolicitud(rut: string): Observable<EmpresaLookup> {
    return this.http.get<EmpresaLookup>(
      `${this.apiUrl}/laboral/solicitudes-empresa/consulta/${encodeURIComponent(rut)}`
    );
  }

  solicitarCuentaEmpresa(
    datos: SolicitudCuentaEmpresaInput
  ): Observable<SolicitudCuentaEmpresaCreada> {
    return this.http.post<SolicitudCuentaEmpresaCreada>(
      `${this.apiUrl}/laboral/solicitudes-empresa`,
      datos
    );
  }

  listarSolicitudesEmpresa(): Observable<SolicitudCuentaEmpresa[]> {
    return this.http.get<SolicitudCuentaEmpresa[]>(
      `${this.apiUrl}/laboral/solicitudes-empresa`
    );
  }

  resolverSolicitudEmpresa(
    idSolicitud: number,
    datos: ResolverSolicitudCuentaEmpresa
  ): Observable<SolicitudCuentaEmpresaResuelta> {
    return this.http.patch<SolicitudCuentaEmpresaResuelta>(
      `${this.apiUrl}/laboral/solicitudes-empresa/${idSolicitud}`,
      datos
    );
  }
}
