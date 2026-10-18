import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { AuthStore } from './core/store/auth.store';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  constructor(
    private readonly router: Router,
    private readonly auth: AuthStore
  ) {}

  esLogin(): boolean {
    return this.router.url === '/login';
  }

  esRutaActiva(ruta: string): boolean {
    return this.router.url === ruta || this.router.url.startsWith(`${ruta}/`);
  }

  get esGestor(): boolean {
    return this.auth.contexto()?.roles.some(rol =>
      rol === 'GESTOR' || rol === 'ADMINISTRADOR'
    ) ?? false;
  }

  get esAdministrador(): boolean {
    return this.auth.contexto()?.roles.includes('ADMINISTRADOR') ?? false;
  }

  get nombreUsuario(): string {
    const usuario = this.auth.contexto()?.usuario;
    return usuario ? `${usuario.nombre} ${usuario.apellido}` : 'Usuario';
  }

  get inicialesUsuario(): string {
    return this.nombreUsuario.split(/\s+/).filter(Boolean).slice(0, 2)
      .map(parte => parte.charAt(0)).join('').toUpperCase() || 'U';
  }

  get rolUsuario(): string {
    if (this.esAdministrador) return 'Administrador';
    if (this.esGestor) return 'Gestor de prácticas';
    return 'Estudiante';
  }
}
