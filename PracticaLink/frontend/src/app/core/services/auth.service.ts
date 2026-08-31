import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

import {
  ContextoUsuarioResponse,
  LoginRequest,
  LoginResponse,
  RegistroRequest,
  RegistroResponse
} from '../models/auth.models';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  login(datos: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(
      `${this.apiUrl}/auth/login`,
      datos
    );
  }

  registrar(datos: RegistroRequest): Observable<RegistroResponse> {
    return this.http.post<RegistroResponse>(
      `${this.apiUrl}/auth/register`,
      datos
    );
  }

  obtenerContexto(): Observable<ContextoUsuarioResponse> {
    return this.http.get<ContextoUsuarioResponse>(
      `${this.apiUrl}/auth/context`
    );
  }
}
