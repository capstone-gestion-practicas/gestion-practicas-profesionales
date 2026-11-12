import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEvent } from '@angular/common/http';
import { Observable, map, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

export const FORMATOS_INFORME = {
  PDF: { mime: 'application/pdf', extension: '.pdf' },
  DOCX: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' }
} as const;
export type FormatoInforme = keyof typeof FORMATOS_INFORME;
export type MimeInforme = typeof FORMATOS_INFORME[FormatoInforme]['mime'];

/** Tamaño legible en KB o MB; no altera los límites ni la validación real del archivo. */
export function tamanoLegible(bytes: number | null): string {
  if (bytes === null) return 'Tamaño no disponible';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

export function errorArchivo(file: File): string | null {
  if (file.size === 0) return 'Selecciona un PDF o DOCX no vacío.';
  if (file.size > 10 * 1024 * 1024) return 'El máximo permitido es 10 MiB.';
  const name = file.name.toLowerCase();
  const formato = name.endsWith('.pdf') ? FORMATOS_INFORME.PDF
    : name.endsWith('.docx') ? FORMATOS_INFORME.DOCX : null;
  if (!formato) return 'Solo se admiten archivos .pdf y .docx.';
  if (file.type !== '' && file.type.toLowerCase() !== formato.mime) return 'El tipo MIME del archivo no coincide con PDF o DOCX. Comprueba el archivo y vuelve a seleccionarlo.';
  return null;
}

export interface Informe {
  id_practica: number;
  estado: 'SIN_ENTREGAR' | 'ENTREGADO' | 'EN_EVALUACION';
  version: number;
  id_documento: number | null;
  nombre: string | null;
  tamano: number | null;
  fecha: string | null;
  formato: FormatoInforme | null;
  mime_type: MimeInforme | null;
  habilitada: boolean;
  fecha_habilitada: string | null;
}
export interface EntregaInforme {
  id_entrega: string;
  id_documento: number;
  version: number;
  fecha: string;
  estado: 'ENTREGADO';
  formato: FormatoInforme;
  mime_type: MimeInforme;
}
export interface ArchivoInforme { blob: Blob; nombre: string; }

@Injectable({ providedIn: 'root' })
export class InformeService {
  private readonly http = inject(HttpClient);
  private ruta(id: number): string { return `${environment.apiUrl}/practicas/${id}/informe-final`; }
  consultar(id: number) { return this.http.get<Informe>(this.ruta(id)); }
  entregar(id: number, file: File, key: string, version: number): Observable<HttpEvent<EntregaInforme>> {
    const error = errorArchivo(file);
    if (error) return throwError(() => new HttpErrorResponse({ status: 422, error: { detail: error } }));
    // An absent browser MIME is not a content verdict: the server still parses bytes.
    const mime = file.type === ''
      ? (file.name.toLowerCase().endsWith('.pdf') ? FORMATOS_INFORME.PDF.mime : FORMATOS_INFORME.DOCX.mime)
      : file.type.toLowerCase();
    return this.http.post<EntregaInforme>(this.ruta(id), file, {
      headers: { 'Content-Type': mime, 'Idempotency-Key': key,
        'Version-Esperada': String(version), 'Nombre-Archivo': encodeURIComponent(file.name) },
      observe: 'events', reportProgress: true
    });
  }
  descargar(id: number) {
    return this.http.get(`${this.ruta(id)}/archivo`, { responseType: 'blob', observe: 'response' }).pipe(
      map(response => {
        const mime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
        const extension = mime === FORMATOS_INFORME.PDF.mime ? '.pdf'
          : mime === FORMATOS_INFORME.DOCX.mime ? '.docx' : null;
        if (!response.body || !extension) throw new HttpErrorResponse({ status: 502 });
        // Content-Type is CORS-safelisted. Never trust a filename or private Storage URL.
        return { blob: response.body, nombre: `informe-final${extension}` } satisfies ArchivoInforme;
      })
    );
  }
}
