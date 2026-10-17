import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { NotificacionesResumen } from '../models/notificacion.models';

@Injectable({ providedIn: 'root' })
export class NotificacionService {
  private readonly apiUrl = `${environment.apiUrl}/notificaciones`;
  readonly noLeidas = signal(0);

  constructor(private readonly http: HttpClient) {}

  listar(): Observable<NotificacionesResumen> {
    return this.http.get<NotificacionesResumen>(this.apiUrl);
  }

  marcarLeida(id: number): Observable<void> {
    return this.http.patch<void>(`${this.apiUrl}/${id}/leida`, {});
  }

  marcarTodasLeidas(): Observable<{ actualizadas: number }> {
    return this.http.patch<{ actualizadas: number }>(`${this.apiUrl}/leidas`, {});
  }
}
