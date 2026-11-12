import { Component, inject } from '@angular/core';
import { AuthStore } from '../../core/store/auth.store';
import { muestraEspacioAdministrador } from '../../core/navigation/espacio-administrador';

/** Presentación, no autorización: preserva las operaciones y controles del servidor. */
@Component({
  selector: 'app-operacion-academica', standalone: true,
  template: `<details [open]="!administrativo" [class.operativa]="!administrativo">
    <summary [hidden]="!administrativo">Operaciones académicas existentes · uso excepcional</summary>
    @if (administrativo) { <p>No es una tarea administrativa habitual. Se conservan estas operaciones con sus permisos y validaciones actuales.</p> }
    <ng-content />
  </details>`,
  styles: [`:host { display: contents; } details:not(.operativa) { padding: var(--space-3); margin-block: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
    .operativa { display: contents; } summary { cursor: pointer; color: var(--color-primary); font-weight: 600; }
    summary:focus-visible { outline: 2px solid var(--color-focus-ring); }`]
})
export class OperacionAcademica {
  private readonly auth = inject(AuthStore);
  get administrativo(): boolean { return muestraEspacioAdministrador(this.auth.contexto()); }
}
