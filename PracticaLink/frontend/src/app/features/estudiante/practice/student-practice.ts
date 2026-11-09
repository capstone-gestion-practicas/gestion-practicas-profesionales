import { InformeFinal } from '../../informe-final/informe-final';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { PracticaService } from '../../../core/services/practica.service';
import { AuthStore } from '../../../core/store/auth.store';
import { HistorialEstadoPractica, PracticaDetalleResponse } from '../../../core/models/practica.models';
import { EstadoBadge } from '../../../shared/components/estado-badge/estado-badge';

const MENSAJES_ESTADO: Readonly<Record<string, string>> = {
  REGISTRADA: 'Tu práctica fue registrada.',
  EN_REVISION: 'Tu práctica está siendo revisada.',
  OBSERVADA: 'Tu práctica tiene observaciones. Revisa el historial y responde lo solicitado.',
  APROBADA: 'Tu solicitud de práctica fue aprobada. La aprobación académica requiere la evaluación del informe final.',
  EN_CURSO: 'Tu práctica está en curso.',
  FINALIZADA: 'Tu práctica finalizó.',
  RECHAZADA: 'Tu práctica fue rechazada. Revisa el historial para conocer las observaciones disponibles.'
};

@Component({
  selector: 'app-student-practice',
  standalone: true,
  imports: [CommonModule, FormsModule, EstadoBadge, InformeFinal],
  templateUrl: './student-practice.html',
  styleUrl: './student-practice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudentPractice {
  private readonly authStore = inject(AuthStore);
  private readonly practicaService = inject(PracticaService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reintentoDetalle = signal(0);
  private generacion = 0;
  private respuestaSubscription?: Subscription;
  private historialRetrySubscription?: Subscription;
  private ultimoIdPractica: number | null = null;

  get contextoDisponible(): boolean {
    return this.authStore.contexto() !== null;
  }

  readonly solicitarCompletarPerfil = output<void>();
  readonly solicitarRegistroPractica = output<void>();
  readonly detalle = signal<PracticaDetalleResponse | null>(null);
  readonly historial = signal<HistorialEstadoPractica[]>([]);
  readonly cargandoDetalle = signal(false);
  readonly cargandoHistorial = signal(false);
  readonly enviandoRespuesta = signal(false);
  readonly errorDetalle = signal('');
  readonly errorCoherencia = signal('');
  readonly errorHistorial = signal('');
  readonly errorEnvio = signal('');
  readonly errorActualizacion = signal('');
  readonly mensajeExito = signal('');
  respuestaObservacion = '';

  constructor() {
    effect((onCleanup) => {
      const contexto = this.authStore.contexto();
      this.reintentoDetalle();
      this.historialRetrySubscription?.unsubscribe();
      this.historialRetrySubscription = undefined;
      const generacion = ++this.generacion;
      const idActual = contexto?.practica_actual?.id_practica ?? null;
      const mismoId = idActual !== null && idActual === this.ultimoIdPractica;
      this.ultimoIdPractica = idActual;
      this.limpiarDatos(mismoId);

      if (!contexto?.perfil || !contexto.practica_actual) return;

      const idEsperado = contexto.practica_actual.id_practica;
      this.cargandoDetalle.set(true);
      const solicitudes = new Subscription();
      solicitudes.add(this.practicaService.obtenerMiPractica().subscribe({
        next: practica => {
          if (!this.esGeneracionActual(generacion, idEsperado)) return;
          this.cargandoDetalle.set(false);
          if (practica.id_practica !== idEsperado) {
            this.errorCoherencia.set(
              'La práctica del contexto y los antecedentes recibidos no coinciden. No mostramos información combinada. Intenta actualizar.'
            );
            return;
          }
          this.detalle.set(practica);
          this.cargandoHistorial.set(true);
          solicitudes.add(this.practicaService.obtenerHistorialEstados(idEsperado).subscribe({
            next: historial => {
              if (!this.esGeneracionActual(generacion, idEsperado)) return;
              this.historial.set(historial);
              this.cargandoHistorial.set(false);
            },
            error: () => {
              if (!this.esGeneracionActual(generacion, idEsperado)) return;
              this.errorHistorial.set('No fue posible cargar el historial de estados.');
              this.cargandoHistorial.set(false);
            }
          }));
        },
        error: (error: HttpErrorResponse) => {
          if (!this.esGeneracionActual(generacion, idEsperado)) return;
          this.cargandoDetalle.set(false);
          this.errorDetalle.set(error.status === 404
            ? 'No fue posible cargar los antecedentes de la práctica.'
            : 'Ocurrió un error al cargar los antecedentes de la práctica.');
        }
      }));
      onCleanup(() => solicitudes.unsubscribe());
    });

    this.destroyRef.onDestroy(() => {
      this.respuestaSubscription?.unsubscribe();
      this.historialRetrySubscription?.unsubscribe();
    });
  }

  get tienePerfil(): boolean {
    const contexto = this.authStore.contexto();
    return contexto !== null && contexto.perfil !== null;
  }

  get tienePracticaEnContexto(): boolean {
    const contexto = this.authStore.contexto();
    return contexto !== null && contexto.practica_actual !== null;
  }

  get esObservada(): boolean {
    return this.detalle()?.estado.nombre.toUpperCase() === 'OBSERVADA';
  }

  mensajeEstado(estado: string): string {
    return MENSAJES_ESTADO[estado.toUpperCase()]
      ?? 'No pudimos identificar el estado actual de tu práctica. Consulta el historial para más información.';
  }

  ultimaObservacion(): HistorialEstadoPractica | null {
    return this.historial()
      .filter(evento => Boolean(evento.observacion) && evento.estado.toUpperCase() === 'OBSERVADA')
      .sort((a, b) => b.fecha_cambio.localeCompare(a.fecha_cambio))[0] ?? null;
  }

  reintentarDetalle(): void {
    this.reintentoDetalle.update(valor => valor + 1);
  }

  reintentarHistorial(): void {
    const practica = this.detalle();
    const idContexto = this.authStore.contexto()?.practica_actual?.id_practica;
    if (!practica || practica.id_practica !== idContexto || this.cargandoHistorial()) return;

    this.cargandoHistorial.set(true);
    this.errorHistorial.set('');
    this.historialRetrySubscription = this.practicaService.obtenerHistorialEstados(practica.id_practica).subscribe({
      next: historial => {
        if (this.authStore.contexto()?.practica_actual?.id_practica !== practica.id_practica) return;
        this.historial.set(historial);
        this.cargandoHistorial.set(false);
      },
      error: () => {
        if (this.authStore.contexto()?.practica_actual?.id_practica !== practica.id_practica) return;
        this.errorHistorial.set('No fue posible cargar el historial de estados.');
        this.cargandoHistorial.set(false);
      }
    });
  }

  responderObservacion(): void {
    const practica = this.detalle();
    const respuesta = this.respuestaObservacion.trim();
    if (this.enviandoRespuesta() || !practica || !this.esObservada) return;
    if (!respuesta || respuesta.length > 500) {
      this.errorEnvio.set('La respuesta es obligatoria y debe tener un máximo de 500 caracteres.');
      return;
    }

    this.enviandoRespuesta.set(true);
    this.errorEnvio.set('');
    this.errorActualizacion.set('');
    this.mensajeExito.set('');
    this.respuestaSubscription = this.practicaService.responderObservacion(practica.id_practica, respuesta).subscribe({
      next: resultado => {
        if (this.authStore.contexto()?.practica_actual?.id_practica !== practica.id_practica) return;
        this.enviandoRespuesta.set(false);
        this.respuestaObservacion = '';
        this.mensajeExito.set(resultado.mensaje);
        this.refrescarContextoYPractica(practica.id_practica);
      },
      error: () => {
        if (this.authStore.contexto()?.practica_actual?.id_practica !== practica.id_practica) return;
        this.enviandoRespuesta.set(false);
        this.errorEnvio.set('No fue posible enviar tu respuesta. El texto se conservó para que puedas reintentar.');
      }
    });
  }

  /** Semanas entre fechas reales; sin fechas completas no se calcula nada. */
  duracionSemanas(inicio: string | null, termino: string | null): number | null {
    if (!inicio || !termino) return null;
    const desde = Date.parse(inicio);
    const hasta = Date.parse(termino);
    if (Number.isNaN(desde) || Number.isNaN(hasta) || hasta <= desde) return null;
    return Math.round((hasta - desde) / (7 * 24 * 60 * 60 * 1000));
  }

  fechaCalendario(fecha: string | null): string | null {
    if (!fecha) return null;
    const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
    return coincidencia ? `${coincidencia[3]}/${coincidencia[2]}/${coincidencia[1]}` : fecha;
  }

  private refrescarContextoYPractica(idPractica: number): void {
    this.errorActualizacion.set('');
    this.respuestaSubscription = this.authService.obtenerContexto().subscribe({
      next: contexto => {
        if (this.authStore.contexto()?.practica_actual?.id_practica !== idPractica) return;
        this.authStore.setContexto(contexto);
        // El cambio de contexto activa la carga detalle + historial mediante el effect.
      },
      error: () => {
        if (this.authStore.contexto()?.practica_actual?.id_practica !== idPractica) return;
        this.errorActualizacion.set('Tu respuesta fue enviada, pero no pudimos actualizar la información de la práctica.');
        this.reintentarDetalle();
      }
    });
  }

  private esGeneracionActual(generacion: number, idPractica: number): boolean {
    return generacion === this.generacion
      && this.authStore.contexto()?.practica_actual?.id_practica === idPractica;
  }

  private limpiarDatos(preservarResultadoEnvio: boolean): void {
    this.detalle.set(null);
    this.historial.set([]);
    this.cargandoDetalle.set(false);
    this.cargandoHistorial.set(false);
    this.errorDetalle.set('');
    this.errorCoherencia.set('');
    this.errorHistorial.set('');
    if (!preservarResultadoEnvio) {
      this.errorEnvio.set('');
      this.errorActualizacion.set('');
      this.mensajeExito.set('');
      this.respuestaObservacion = '';
    }
  }
}
