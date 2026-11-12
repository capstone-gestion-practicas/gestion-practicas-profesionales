import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/store/auth.store';
import { muestraEspacioAdministrador } from '../../core/navigation/espacio-administrador';

@Component({
  selector: 'app-supervision-admin', standalone: true,
  template: `@if (administrativo) {
    <section aria-label="Supervisión administrativa">
      <p>Supervisión administrativa. El acompañamiento y las decisiones académicas corresponden al GESTOR y al DOCENTE.</p>
      <nav aria-label="Consultas de supervisión">
        @for (destino of destinos; track destino.ruta) {
          <button type="button" [class.activo]="activa(destino.ruta)" [attr.aria-current]="activa(destino.ruta) ? 'page' : null" (click)="irA(destino.ruta)">{{ destino.nombre }}</button>
        }
      </nav>
    </section>
  }`,
  styles: [`section { margin-bottom: var(--space-4); } nav { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    button { color: var(--color-primary); padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); font: inherit; cursor: pointer; } .activo { font-weight: 700; }
    button:hover { background: var(--color-surface-muted); } button:focus-visible { outline: 2px solid var(--color-focus-ring); }`]
})
export class SupervisionAdmin {
  private readonly auth = inject(AuthStore);
  readonly router = inject(Router);
  readonly destinos = [{ nombre: 'Prácticas', ruta: '/practicas' }, { nombre: 'Seguimientos', ruta: '/seguimientos' }, { nombre: 'Incidencias', ruta: '/incidencias' }];
  irA(ruta: string): void { void this.router.navigate([ruta]); }
  activa(ruta: string): boolean { return (this.router.url ?? '').startsWith(ruta); }
  get administrativo(): boolean { return muestraEspacioAdministrador(this.auth.contexto()); }
}
