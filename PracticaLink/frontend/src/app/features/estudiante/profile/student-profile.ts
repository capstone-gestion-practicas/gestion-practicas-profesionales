import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, viewChild } from '@angular/core';

import { AuthStore } from '../../../core/store/auth.store';

const SIN_DATO = 'No registrado';

/** Consulta de solo lectura de los datos de la cuenta y del perfil académico. */
@Component({
  selector: 'app-student-profile',
  standalone: true,
  templateUrl: './student-profile.html',
  styleUrl: './student-profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudentProfile {
  private readonly authStore = inject(AuthStore);
  readonly contexto = this.authStore.contexto;
  private readonly titulo = viewChild<ElementRef<HTMLHeadingElement>>('titulo');

  readonly nombreCompleto = computed(() => {
    const usuario = this.contexto()?.usuario;
    return usuario ? `${usuario.nombre} ${usuario.apellido}`.trim() || SIN_DATO : SIN_DATO;
  });

  readonly inicial = computed(() => this.contexto()?.usuario.nombre.trim().charAt(0) || '?');

  constructor() {
    // Al entrar desde el menú de cuenta, el foco va al título de la página.
    afterNextRender(() => this.titulo()?.nativeElement.focus());
  }

  /** Valor real o indicación explícita de dato no registrado; nunca un valor inventado. */
  valor(dato: string | null | undefined): string {
    const texto = dato?.trim() ?? '';
    return texto.length > 0 ? texto : SIN_DATO;
  }
}
