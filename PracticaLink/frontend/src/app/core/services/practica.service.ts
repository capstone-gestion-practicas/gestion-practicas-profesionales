import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  PracticaCreate,
  PracticaCreateResponse
} from '../models/practica.models';

@Injectable({ providedIn: 'root' })
export class PracticaService {
  private readonly apiUrl = 'http://127.0.0.1:8000';

  constructor(private readonly http: HttpClient) {}

  registrar(datos: PracticaCreate): Observable<PracticaCreateResponse> {
    return this.http.post<PracticaCreateResponse>(
      `${this.apiUrl}/practicas`,
      datos
    );
  }
}
