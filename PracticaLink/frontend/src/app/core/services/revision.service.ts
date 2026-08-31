import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

import {
  DecisionRevision,
  DecisionRevisionResponse,
  SolicitudRevisionDetalle,
  SolicitudRevisionResumen
} from '../models/revision.models';

@Injectable({ providedIn: 'root' })
export class RevisionService {
  private readonly apiUrl = `${environment.apiUrl}/revisiones`;

  constructor(private readonly http: HttpClient) {}

  listar(): Observable<SolicitudRevisionResumen[]> {
    return this.http.get<SolicitudRevisionResumen[]>(`${this.apiUrl}/solicitudes`);
  }

  obtener(idPractica: number): Observable<SolicitudRevisionDetalle> {
    return this.http.get<SolicitudRevisionDetalle>(
      `${this.apiUrl}/solicitudes/${idPractica}`
    );
  }

  resolver(
    idPractica: number,
    decision: DecisionRevision,
    observacion: string | null
  ): Observable<DecisionRevisionResponse> {
    return this.http.patch<DecisionRevisionResponse>(
      `${this.apiUrl}/solicitudes/${idPractica}`,
      { decision, observacion }
    );
  }
}
