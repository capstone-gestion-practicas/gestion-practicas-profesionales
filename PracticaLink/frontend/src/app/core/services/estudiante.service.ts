import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

import {
  PerfilEstudianteCreate,
  PerfilEstudianteResponse
} from '../models/estudiante.models';

@Injectable({ providedIn: 'root' })
export class EstudianteService {
  private readonly apiUrl = environment.apiUrl;

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
