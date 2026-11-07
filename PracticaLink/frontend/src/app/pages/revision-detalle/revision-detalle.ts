import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import {
  IonButton, IonCard, IonCardContent, IonCol, IonContent, IonGrid, IonRow, IonSpinner, IonTextarea
} from '@ionic/angular';

import { DecisionRevision, SolicitudRevisionDetalle } from '../../core/models/revision.models';
import { RevisionService } from '../../core/services/revision.service';
import { formatoHorasEstimadas } from '../../core/utils/horas-estimadas';
import { EstadoBadge } from '../../shared/components/estado-badge/estado-badge';
import { antiguedadDias, fechaEnvio } from '../revisiones/solicitudes-listado';
import {
  LONGITUD_MAXIMA_OBSERVACION,
  fechaCorta,
  horasTexto,
  jornadaTexto,
  motivoSinDecision,
  esRevisable,
  requiereObservacion,
  tituloDecision,
  valorOInformado
} from './detalle-solicitud';

/** Parámetros del listado de origen que se conservan al volver. */
const CLAVES_ORIGEN = ['estado', 'q', 'orden', 'pagina'] as const;

/**
 * Detalle de una solicitud: antecedentes, práctica y panel de decisión. Las decisiones se
 * ofrecen solo en los estados que el backend acepta. El formulario genérico de estado se
 * retiró de esta pantalla; sus servicios siguen disponibles en los flujos administrativos.
 */
@Component({
  selector: 'app-revision-detalle',
  standalone: true,
  imports: [
    FormsModule, IonButton, IonCard, IonCardContent, IonCol, IonContent, IonGrid, IonRow,
    IonSpinner, IonTextarea, EstadoBadge
  ],
  templateUrl: './revision-detalle.html',
  styleUrl: './revision-detalle.scss'
})
export class RevisionDetalle implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly revisionService = inject(RevisionService);

  solicitud: SolicitudRevisionDetalle | null = null;
  cargando = true;
  error = '';
  /** Decisión elegida en el panel; el panel de confirmación solo se muestra tras elegirla. */
  decision: DecisionRevision = 'APROBADA';
  decisionAbierta = false;
  observacion = '';
  guardando = false;
  readonly longitudMaxima = LONGITUD_MAXIMA_OBSERVACION;

  private idPractica = NaN;

  ngOnInit(): void {
    this.idPractica = Number(this.route.snapshot.paramMap.get('id'));
    this.cargar();
  }

  get puedeDecidir(): boolean {
    return this.solicitud !== null && esRevisable(this.solicitud.estado);
  }

  get motivoSinDecision(): string | null {
    return this.solicitud ? motivoSinDecision(this.solicitud.estado) : null;
  }

  get requiereObservacion(): boolean {
    return requiereObservacion(this.decision);
  }

  get tituloDecision(): string {
    return tituloDecision(this.decision);
  }

  cargar(): void {
    this.cargando = true;
    this.error = '';
    if (!Number.isInteger(this.idPractica) || this.idPractica < 1) {
      this.error = 'La solicitud indicada no es válida.';
      this.cargando = false;
      return;
    }
    this.revisionService.obtener(this.idPractica).subscribe({
      next: solicitud => {
        this.solicitud = solicitud;
        this.cargando = false;
      },
      error: () => {
        this.error = 'No fue posible cargar la solicitud.';
        this.cargando = false;
      }
    });
  }

  abrirDecision(decision: DecisionRevision): void {
    if (!this.puedeDecidir) {
      this.error = this.motivoSinDecision ?? 'Esta solicitud no admite decisiones.';
      return;
    }
    this.decision = decision;
    this.observacion = '';
    this.error = '';
    this.decisionAbierta = true;
  }

  cancelarDecision(): void {
    if (this.guardando) return;
    this.decisionAbierta = false;
    this.observacion = '';
    this.error = '';
  }

  confirmar(): void {
    // Evita un segundo envío mientras la decisión anterior sigue en curso.
    if (!this.solicitud || this.guardando) return;
    if (!this.puedeDecidir) {
      this.error = this.motivoSinDecision ?? 'Esta solicitud no admite decisiones.';
      return;
    }
    if (this.requiereObservacion && !this.observacion.trim()) {
      this.error = 'Debes ingresar una observación.';
      return;
    }
    this.guardando = true;
    this.error = '';
    this.revisionService.resolver(
      this.solicitud.id_practica,
      this.decision,
      this.observacion.trim() || null
    ).subscribe({
      next: () => {
        this.guardando = false;
        this.router.navigate(['/revisiones'], { queryParams: this.parametrosOrigen() });
      },
      error: (error: HttpErrorResponse) => {
        this.guardando = false;
        this.error = error.error?.detail ?? 'No fue posible guardar la decisión.';
      }
    });
  }

  /** Vuelve al listado con el mismo estado, búsqueda, orden y página de origen. */
  volver(): void {
    this.router.navigate(['/revisiones'], { queryParams: this.parametrosOrigen() });
  }

  fechaEnvio(): string {
    return this.solicitud ? fechaEnvio(this.solicitud) : '';
  }

  antiguedad(): string {
    const dias = this.solicitud ? antiguedadDias(this.solicitud) : null;
    if (dias === null) return '';
    return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
  }

  valor(texto: string | null | undefined): string {
    return valorOInformado(texto);
  }

  fecha(iso: string | null | undefined): string {
    return fechaCorta(iso);
  }

  horas(horas: number | null | undefined): string {
    return horasTexto(horas);
  }

  jornada(horasSemanales: number | null | undefined): string {
    return jornadaTexto(horasSemanales);
  }

  estimacionHoras(
    fechaInicio: string | null,
    fechaTermino: string | null,
    horasSemanales: number | null
  ): string {
    return formatoHorasEstimadas(fechaInicio, fechaTermino, horasSemanales);
  }

  private parametrosOrigen(): Params {
    const params: Params = {};
    for (const clave of CLAVES_ORIGEN) {
      const valor = this.route.snapshot.queryParamMap?.get(clave);
      if (valor) params[clave] = valor;
    }
    return params;
  }
}
