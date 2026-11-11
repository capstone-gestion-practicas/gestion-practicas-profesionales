import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router
} from '@angular/router';

import { catchError, map, of } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { AuthStore } from '../store/auth.store';

/**
 * Destino cuando la ruta no admite el rol del usuario. Un docente sin rol de gestión
 * no tiene más espacio que el suyo: /home no le corresponde, así que va a sus prácticas.
 */
export function destinoSinPermiso(roles: readonly string[]): string {
  const esSoloDocente = roles.includes('DOCENTE')
    && !roles.includes('GESTOR')
    && !roles.includes('ADMINISTRADOR');
  return esSoloDocente ? '/docente/practicas' : '/home';
}

export const roleGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot
) => {
  const authService = inject(AuthService);
  const authStore = inject(AuthStore);
  const router = inject(Router);

  const rolesPermitidos =
    (route.data['roles'] as string[] | undefined) ?? [];

  const contextoActual = authStore.obtenerContextoActual();

  if (contextoActual) {
    const tieneRol = contextoActual.roles.some(
      rol => rolesPermitidos.includes(rol)
    );

    return tieneRol
      ? true
      : router.createUrlTree([destinoSinPermiso(contextoActual.roles)]);
  }

  const token = sessionStorage.getItem('access_token');

  if (!token) {
    return router.createUrlTree(['/login']);
  }

  return authService.obtenerContexto().pipe(
    map(contexto => {
      authStore.setContexto(contexto);

      const tieneRol = contexto.roles.some(
        rol => rolesPermitidos.includes(rol)
      );

      return tieneRol
        ? true
        : router.createUrlTree([destinoSinPermiso(contexto.roles)]);
    }),
    catchError(() => {
      sessionStorage.removeItem('access_token');
      authStore.limpiar();

      return of(
        router.createUrlTree(['/login'])
      );
    })
  );
};