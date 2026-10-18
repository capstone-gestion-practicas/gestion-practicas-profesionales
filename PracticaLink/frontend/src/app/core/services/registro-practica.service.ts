import { Injectable } from '@angular/core';

export type TipoRegistroPractica = 'seguimiento' | 'incidencia';
export type EstadoIncidencia = 'Pendiente' | 'En seguimiento' | 'Resuelta';

export interface RegistroPracticaLocal {
  id: string;
  id_practica: string;
  tipo: TipoRegistroPractica;
  fecha: string;
  tipo_contacto?: string;
  observaciones?: string;
  proxima_fecha?: string;
  estado?: EstadoIncidencia;
  descripcion?: string;
}

@Injectable({ providedIn: 'root' })
export class RegistroPracticaService {
  private readonly storageKey = 'practicalink.registros-practica';

  listar(idPractica: string): RegistroPracticaLocal[] {
    return this.leer().filter(registro => registro.id_practica === idPractica)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  guardar(registro: Omit<RegistroPracticaLocal, 'id'>): RegistroPracticaLocal {
    const nuevoRegistro: RegistroPracticaLocal = {
      ...registro,
      id: globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    };

    try {
      localStorage.setItem(this.storageKey, JSON.stringify([...this.leer(), nuevoRegistro]));
    } catch {
      throw new Error('No se pudo guardar el registro en este navegador.');
    }

    return nuevoRegistro;
  }

  private leer(): RegistroPracticaLocal[] {
    try {
      const registros: unknown = JSON.parse(localStorage.getItem(this.storageKey) ?? '[]');
      return Array.isArray(registros) ? registros as RegistroPracticaLocal[] : [];
    } catch {
      return [];
    }
  }
}