import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/store/auth.store';

@Component({ standalone: true, selector: 'app-espacios-trabajo', imports: [CommonModule, RouterLink],
  templateUrl: './espacios-trabajo.html', styleUrl: './espacios-trabajo.scss' })
export class EspaciosTrabajo {
  private readonly auth = inject(AuthStore);
  readonly espacios = computed(() => {
    const roles = new Set(this.auth.contexto()?.roles ?? []);
    return [
      { rol: 'ESTUDIANTE', nombre: 'Mi práctica', ruta: '/estudiante/inicio' },
      { rol: 'GESTOR', nombre: 'Gestión académica', ruta: '/home' },
      { rol: 'DOCENTE', nombre: 'Evaluación docente', ruta: '/docente/practicas' },
      { rol: 'ADMINISTRADOR', nombre: 'Administración', ruta: '/home' },
    ].filter(espacio => roles.has(espacio.rol));
  });

  seleccionar(rol: string): void {
    sessionStorage.setItem('practicalink-workspace', rol);
  }
}
