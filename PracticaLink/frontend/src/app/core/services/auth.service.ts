import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  ContextoUsuarioResponse,
  LoginRequest,
  LoginResponse
} from '../models/auth.models';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly apiUrl = 'http://127.0.0.1:8000';

  constructor(private readonly http: HttpClient) {}

  login(datos: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(
      `${this.apiUrl}/auth/login`,
      datos
    );
  }

  obtenerContexto(): Observable<ContextoUsuarioResponse> {
    return this.http.get<ContextoUsuarioResponse>(
      `${this.apiUrl}/auth/context`
    );
  }
}