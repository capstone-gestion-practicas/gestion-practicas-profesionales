//auth.store.ts
import { Injectable, signal } from '@angular/core';
import { ContextoUsuarioResponse } from '../models/auth.models';

@Injectable({
  providedIn: 'root'
})
export class AuthStore {
  private readonly contextoSignal =
    signal<ContextoUsuarioResponse | null>(null);

  readonly contexto = this.contextoSignal.asReadonly();

  setContexto(contexto: ContextoUsuarioResponse): void {
    this.contextoSignal.set(contexto);
  }

  obtenerContextoActual(): ContextoUsuarioResponse | null {
    return this.contextoSignal();
  }

  limpiar(): void {
    this.contextoSignal.set(null);
  }
}