import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface Informe {
  id_practica: number;
  estado: 'SIN_ENTREGAR' | 'ENTREGADO' | 'EN_EVALUACION';
  version: number;
  id_documento: number | null;
  nombre: string | null;
  tamano: number | null;
  fecha: string | null;
  habilitada: boolean;
  fecha_habilitada: string | null;
}
@Injectable({ providedIn: 'root' })
export class InformeService {
  private readonly http = inject(HttpClient);
  private ruta(id: number): string { return `${environment.apiUrl}/practicas/${id}/informe-final`; }
  consultar(id: number) { return this.http.get<Informe>(this.ruta(id)); }
  entregar(id: number, file: File, key: string, version: number) {
    return this.http.post<{ version: number }>(this.ruta(id), file, {
      headers: { 'Content-Type': 'application/pdf', 'Idempotency-Key': key,
        'Version-Esperada': String(version), 'Nombre-Archivo': encodeURIComponent(file.name) },
      observe: 'events', reportProgress: true
    });
  }
  descargar(id: number) { return this.http.get(`${this.ruta(id)}/archivo`, { responseType: 'blob' }); }
}
