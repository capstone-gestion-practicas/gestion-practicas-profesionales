import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

import {
  OperacionUsuario, Rol, UsuarioActualizar, UsuarioAdministrable, UsuarioCrear
} from '../models/usuario.models';

@Injectable({ providedIn: 'root' })
export class UsuarioService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/usuarios`;

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
