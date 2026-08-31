import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  OperacionUsuario, Rol, UsuarioActualizar, UsuarioAdministrable, UsuarioCrear
} from '../models/usuario.models';

@Injectable({ providedIn: 'root' })
export class UsuarioService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://127.0.0.1:8000/usuarios';

  listar(): Observable<UsuarioAdministrable[]> {
    return this.http.get<UsuarioAdministrable[]>(this.apiUrl);
  }

  listarRoles(): Observable<Rol[]> {
    return this.http.get<Rol[]>(`${this.apiUrl}/roles`);
  }

  crear(datos: UsuarioCrear): Observable<OperacionUsuario> {
    return this.http.post<OperacionUsuario>(this.apiUrl, datos);
  }

  actualizar(idUsuario: number, datos: UsuarioActualizar): Observable<OperacionUsuario> {
    return this.http.patch<OperacionUsuario>(`${this.apiUrl}/${idUsuario}`, datos);
  }
}
