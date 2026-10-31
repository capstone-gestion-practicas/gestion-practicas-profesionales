import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  PerfilEstudianteCreate,
  PerfilEstudianteResponse
} from '../models/estudiante.models';

@Injectable({ providedIn: 'root' })
export class EstudianteService {
  private readonly apiUrl = 'http://127.0.0.1:8000';

  constructor(private readonly http: HttpClient) {}

  completarPerfil(
    datos: PerfilEstudianteCreate
  ): Observable<PerfilEstudianteResponse> {
    return this.http.post<PerfilEstudianteResponse>(
      `${this.apiUrl}/estudiantes/perfil`,
      datos
    );
  }
}
