import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnChanges,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { IonButton, IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { CerrarPracticaResponse } from '../../../core/models/practica.models';
import { PracticaService } from '../../../core/services/practica.service';
import { EstadoAcademico, EvaluacionService, aprobacionVigente } from '../../evaluaciones/evaluacion.service';
import { mensajeAprobacionAcademica, mensajeErrorConsultaAcademica } from './cierre-reglas';

/** Mensaje de cierre fallido sin detalle del servidor (el mismo que GestionEstados). */
const ERROR_CIERRE = 'No fue posible finalizar la práctica.';

/**
 * Cierre académico de UNA práctica: consulta la aprobación vigente y, solo con ella,
 * solicita el cierre. No decide quién puede cerrar: la pantalla contenedora calcula
 * `candidata` (p. ej. con esCandidataCierre) y el servidor valida todo de nuevo
 * (POST /practicas/{id}/cierre → fn_cerrar_practica → validar_cierre).
 *
 * Concurrencia:
 * - Cada cambio de `idPractica` o `candidata` abre una nueva «generación»: se descarta la
 *   aprobación, se cancela la consulta en curso y cualquier respuesta posterior de una
 *   generación anterior se ignora.
 * - El cierre en vuelo NO se cancela (abortar un POST no garantiza que el servidor no lo
 *   procese); su resultado solo se aplica si la generación sigue vigente y el componente no
 *   se destruyó. Nunca se reintenta automáticamente.
 */
@Component({
  selector: 'app-cierre-practica',
  standalone: true,
  imports: [IonButton, IonSpinner],
  templateUrl: './cierre-practica.html',
  styleUrl: './cierre-practica.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CierrePractica implements OnChanges {
  private readonly evaluaciones = inject(EvaluacionService);
  private readonly practicas = inject(PracticaService);

  readonly idPractica = input.required<number>();
  /** Calculada por la pantalla contenedora; sin ella el componente no muestra nada. */
  readonly candidata = input.required<boolean>();
  /** Se emite una sola vez, solo cuando el backend confirma el cierre. */
  readonly cerrada = output<CerrarPracticaResponse>();

  protected readonly estadoAcademico = signal<EstadoAcademico | null>(null);
  protected readonly consultando = signal(false);
  protected readonly errorConsulta = signal('');
  protected readonly cerrando = signal(false);
  protected readonly errorCierre = signal('');
  protected readonly mensajeExito = signal('');
  protected readonly finalizada = signal(false);

  protected readonly mensajeAprobacion = computed(() =>
    mensajeAprobacionAcademica(this.consultando(), this.estadoAcademico()));

  /** Finalizar solo con aprobación vigente comprobada y sin otra operación en curso. */
  readonly puedeFinalizar = computed(() =>
    this.candidata() && !this.finalizada() && !this.consultando() && !this.cerrando()
    && aprobacionVigente(this.estadoAcademico()));

  private generacion = 0;
  private destruido = false;
  private consulta?: Subscription;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destruido = true;
      this.consulta?.unsubscribe();
    });
  }

  ngOnChanges(): void {
    this.reiniciar();
  }

  consultarAprobacion(): void {
    if (!this.candidata() || this.finalizada() || this.consultando() || this.cerrando()) return;
    const generacion = this.generacion;
    const id = this.idPractica();
    this.estadoAcademico.set(null);
    this.errorConsulta.set('');
    this.errorCierre.set('');
    this.consultando.set(true);
    this.consulta = this.evaluaciones.vigente(id).subscribe({
      next: estado => {
        if (!this.vigente(generacion, id)) return;
        this.estadoAcademico.set(estado);
        this.consultando.set(false);
      },
      error: (error: HttpErrorResponse) => {
        if (!this.vigente(generacion, id)) return;
        this.consultando.set(false);
        this.errorConsulta.set(mensajeErrorConsultaAcademica(error.status));
      }
    });
  }

  finalizar(): void {
    if (!this.puedeFinalizar()) return;
    const generacion = this.generacion;
    const id = this.idPractica();
    this.cerrando.set(true);
    this.errorCierre.set('');
    this.practicas.cerrarPractica(id, null).subscribe({
      next: respuesta => {
        if (!this.vigente(generacion, id)) return;
        this.cerrando.set(false);
        this.finalizada.set(true);
        this.estadoAcademico.set(null);
        this.mensajeExito.set(respuesta.mensaje);
        this.cerrada.emit(respuesta);
      },
      error: (error: HttpErrorResponse) => {
        if (!this.vigente(generacion, id)) return;
        this.cerrando.set(false);
        // Igual que GestionEstados: tras un rechazo hay que volver a consultar la aprobación.
        this.estadoAcademico.set(null);
        this.errorCierre.set(typeof error.error?.detail === 'string' ? error.error.detail : ERROR_CIERRE);
      }
    });
  }

  /**
   * La respuesta pertenece a la práctica y condición actuales y el componente sigue vivo.
   * Las entradas se leen directamente (no solo la generación) porque una respuesta puede
   * llegar después de cambiar la entrada y antes de que ngOnChanges abra la nueva generación.
   */
  private vigente(generacion: number, id: number): boolean {
    return !this.destruido && generacion === this.generacion && id === this.idPractica() && this.candidata();
  }

  private reiniciar(): void {
    this.generacion++;
    this.consulta?.unsubscribe();
    this.consulta = undefined;
    this.estadoAcademico.set(null);
    this.consultando.set(false);
    this.errorConsulta.set('');
    this.cerrando.set(false);
    this.errorCierre.set('');
    this.mensajeExito.set('');
    this.finalizada.set(false);
  }
}
