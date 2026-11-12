import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthStore } from '../../../core/store/auth.store';
import { EstadoBadge, presentarEstado } from '../../../shared/components/estado-badge/estado-badge';

@Component({
  selector: 'app-student-home',
  standalone: true,
  imports: [EstadoBadge, RouterLink],
  templateUrl: './student-home.html',
  styleUrl: './student-home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudentHome {
  private readonly authStore = inject(AuthStore);

  readonly contexto = this.authStore.contexto;
  readonly solicitarCompletarPerfil = output<void>();
  readonly solicitarRegistroPractica = output<void>();

  readonly nombreCompleto = computed(() => {
    const usuario = this.contexto()?.usuario;
    return usuario ? `${usuario.nombre} ${usuario.apellido}`.trim() : '';
  });

  readonly proximaAccion = computed(() => {
    const contexto = this.contexto();
    if (!contexto) return null;
    if (!contexto.perfil) return 'perfil' as const;
    if (!contexto.practica_actual) return 'practica' as const;
    if (contexto.practica_actual.estado.nombre.toUpperCase() === 'OBSERVADA') return 'observacion' as const;
    return null;
  });

  /** Etapas reales del proceso. OBSERVADA se sitúa en la etapa de revisión; RECHAZADA no tiene línea de etapas. */
  private readonly etapas = ['REGISTRADA', 'EN_REVISION', 'APROBADA', 'EN_CURSO', 'FINALIZADA'];

  readonly lineaDeEtapas = computed(() => {
    const nombre = this.contexto()?.practica_actual?.estado.nombre.toUpperCase();
    if (!nombre || nombre === 'RECHAZADA') return null;
    const indice = nombre === 'OBSERVADA' ? 1 : this.etapas.indexOf(nombre);
    if (indice < 0) return null;
    return this.etapas.map((clave, posicion) => ({
      etiqueta: presentarEstado(clave).etiqueta,
      estado: posicion < indice ? 'completada' as const : posicion === indice ? 'actual' as const : 'pendiente' as const
    }));
  });

  /** Mensaje informativo según el estado real; sin acciones nuevas. */
  readonly mensajeContextual = computed(() => {
    const nombre = this.contexto()?.practica_actual?.estado.nombre.toUpperCase();
    switch (nombre) {
      case 'REGISTRADA': return 'Tu práctica fue registrada.';
      case 'EN_REVISION': return 'Tu práctica está siendo revisada por coordinación de prácticas.';
      case 'OBSERVADA': return 'Tu práctica tiene observaciones. Responde para que vuelva a revisión.';
      case 'APROBADA': return 'Tu práctica fue aprobada.';
      case 'EN_CURSO': return 'Tu práctica se encuentra en curso.';
      case 'FINALIZADA': return 'Tu práctica finalizó.';
      case 'RECHAZADA': return 'Tu práctica fue rechazada. Puedes consultar el detalle en Mi práctica.';
      default: return null;
    }
  });

  /**
   * Siguiente paso y responsable real según el estado, para los casos sin acción directa
   * del estudiante (proximaAccion() es null). No inventa responsables ni permisos nuevos.
   */
  readonly siguientePasoInfo = computed(() => {
    const nombre = this.contexto()?.practica_actual?.estado.nombre.toUpperCase();
    switch (nombre) {
      case 'REGISTRADA':
        return {
          titulo: 'En espera de revisión',
          detalle: 'Tu solicitud fue registrada y será revisada por coordinación de prácticas.',
          responsable: 'Responsable de la siguiente acción: coordinación de prácticas.'
        };
      case 'EN_REVISION':
        return {
          titulo: 'En revisión',
          detalle: 'Coordinación de prácticas está evaluando tu solicitud.',
          responsable: 'Responsable de la siguiente acción: coordinación de prácticas.'
        };
      case 'APROBADA':
        return {
          titulo: 'Aprobada, pendiente de inicio formal',
          detalle: 'Tu práctica fue aprobada. Coordinación debe iniciarla formalmente para que quede en curso.',
          responsable: 'Responsable de la siguiente acción: coordinación de prácticas.'
        };
      case 'EN_CURSO':
        return {
          titulo: 'Tu práctica está en curso',
          detalle: 'Continúa tu práctica con normalidad. Cuando se habilite, deberás entregar tu informe final en Mi práctica.',
          responsable: 'Responsable de la siguiente acción: tú, cuando se habilite la entrega del informe final.'
        };
      case 'FINALIZADA':
        return {
          titulo: 'Práctica finalizada',
          detalle: 'Tu práctica concluyó.',
          responsable: 'No queda una acción pendiente.'
        };
      case 'RECHAZADA':
        return {
          titulo: 'Práctica rechazada',
          detalle: 'Tu solicitud fue rechazada. Revisa el historial en Mi práctica para conocer el detalle.',
          responsable: 'No hay una acción automática pendiente; consulta a coordinación si tienes dudas.'
        };
      default: return null;
    }
  });

  /** Duración en semanas calculada solo con las fechas reales de la práctica. */
  readonly duracionSemanas = computed(() => {
    const practica = this.contexto()?.practica_actual;
    if (!practica?.fecha_inicio || !practica?.fecha_termino) return null;
    const inicio = Date.parse(practica.fecha_inicio);
    const termino = Date.parse(practica.fecha_termino);
    if (Number.isNaN(inicio) || Number.isNaN(termino) || termino <= inicio) return null;
    return Math.round((termino - inicio) / (7 * 24 * 60 * 60 * 1000));
  });

  fechaCalendario(fecha: string | null): string | null {
    if (!fecha) return null;
    const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
    return coincidencia ? `${coincidencia[3]}/${coincidencia[2]}/${coincidencia[1]}` : fecha;
  }
}
