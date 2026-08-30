import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router
} from '@angular/router';

import { catchError, map, of } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { AuthStore } from '../store/auth.store';

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
      : router.createUrlTree(['/home']);
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
        : router.createUrlTree(['/home']);
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