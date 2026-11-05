import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthStore } from '../store/auth.store';

/** Lleva al espacio V3 al estudiante exclusivo y conserva /home para perfiles de gestión. */
export const studentHomeSpaceGuard: CanActivateFn = () => {
  const contexto = inject(AuthStore).obtenerContextoActual();
  const router = inject(Router);
  if (!contexto) return true;

  const roles = contexto.roles;
  const esEstudianteExclusivo = roles.includes('ESTUDIANTE')
    && !roles.includes('GESTOR')
    && !roles.includes('ADMINISTRADOR');

  return esEstudianteExclusivo ? router.parseUrl('/estudiante/inicio') : true;
};
