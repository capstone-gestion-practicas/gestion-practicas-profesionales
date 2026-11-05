import { Injectable, inject } from '@angular/core';
import { Observable, switchMap, tap } from 'rxjs';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { PerfilEstudianteCreate } from '../../../core/models/estudiante.models';
import { AuthService } from '../../../core/services/auth.service';
import { EstudianteService } from '../../../core/services/estudiante.service';
import { AuthStore } from '../../../core/store/auth.store';

/** Operación compartida de completar perfil y refrescar el contexto autenticado. */
@Injectable({ providedIn: 'root' })
export class PerfilEstudianteWorkflowService {
  private readonly estudianteService = inject(EstudianteService);
  private readonly authService = inject(AuthService);
  private readonly authStore = inject(AuthStore);

  completar(datos: PerfilEstudianteCreate): Observable<ContextoUsuarioResponse> {
    return this.estudianteService.completarPerfil(datos).pipe(
      switchMap(() => this.authService.obtenerContexto()),
      tap(contexto => this.authStore.setContexto(contexto))
    );
  }
}
