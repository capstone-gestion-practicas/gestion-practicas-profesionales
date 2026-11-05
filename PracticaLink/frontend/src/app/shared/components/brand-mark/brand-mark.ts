import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { schoolOutline } from 'ionicons/icons';

export type VarianteBrandMark = 'completa' | 'compacta';
export type TonoBrandMark = 'claro' | 'oscuro';

/**
 * Marca PracticaLink con el mismo icono académico (school-outline) del Login.
 * `claro`: para fondos oscuros; `oscuro`: para fondos claros.
 * El texto puede ocultarse desde el contexto que lo contiene con la propiedad
 * `--brand-mark-texto` (por ejemplo, en el rail compacto); el nombre accesible
 * lo aporta el enlace contenedor.
 */
@Component({
  selector: 'app-brand-mark',
  standalone: true,
  imports: [IonIcon],
  templateUrl: './brand-mark.html',
  styleUrl: './brand-mark.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BrandMark {
  readonly variante = input<VarianteBrandMark>('completa');
  readonly tono = input<TonoBrandMark>('claro');

  constructor() {
    addIcons({ schoolOutline });
  }
}
