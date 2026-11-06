import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, concatMap, from, map, of } from 'rxjs';

import { AuthStore } from '../../../core/store/auth.store';
import { PracticaService } from '../../../core/services/practica.service';
import { RevisionService } from '../../../core/services/revision.service';
import { esPorRevisar } from '../../../core/services/solicitudes-pendientes.service';
import { EstudianteSinPractica, IncidenciaPractica } from '../../../core/models/practica.models';
import { SolicitudRevisionResumen } from '../../../core/models/revision.models';
import { EstadoBadge } from '../../../shared/components/estado-badge/estado-badge';

type FiltroSolicitud = 'TODAS' | 'REGISTRADA' | 'EN_REVISION' | 'OBSERVADA';

interface ResultadoRecordatorio {
  mensaje: string;
  error: boolean;
}

interface RespuestaRecordatorio {
  id: number;
  ok: boolean;
  mensaje: string;
}

const FILTROS: { valor: FiltroSolicitud; etiqueta: string }[] = [
  { valor: 'TODAS', etiqueta: 'Todas' },
  { valor: 'REGISTRADA', etiqueta: 'Registradas' },
  { valor: 'EN_REVISION', etiqueta: 'En revisión' },
  { valor: 'OBSERVADA', etiqueta: 'Observadas' }
];

const MS_DIA = 86_400_000;

function marca(fecha: string): number {
  const tiempo = Date.parse(fecha);
  return Number.isNaN(tiempo) ? 0 : tiempo;
}

function antiguedadDias(fecha: string): number | null {
  const tiempo = Date.parse(fecha);
  return Number.isNaN(tiempo) ? null : Math.floor((Date.now() - tiempo) / MS_DIA);
}

function textoAntiguedad(fecha: string): string {
  const dias = antiguedadDias(fecha);
  if (dias === null) {
    return '';
  }
  if (dias <= 0) {
    return 'hoy';
  }
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
}

function formatearFecha(fecha: string): string {
  const tiempo = Date.parse(fecha);
  return Number.isNaN(tiempo)
    ? ''
    : new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(tiempo));
}

function normalizar(estado: string): string {
  return estado.trim().toUpperCase();
}

function esAbierta(incidencia: IncidenciaPractica): boolean {
  return incidencia.estado === 'ABIERTA' || incidencia.estado === 'EN_REVISION';
}

function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .filter(parte => parte.length > 0)
    .slice(0, 2)
    .map(parte => parte.charAt(0).toUpperCase())
    .join('');
}

function plural(cantidad: number, singular: string, plurales: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plurales}`;
}

function detalleError(error: HttpErrorResponse): string {
  return typeof error.error?.detail === 'string'
    ? error.error.detail
    : 'No fue posible enviar el recordatorio.';
}

/**
 * Espacio operativo del gestor. Muestra solo datos reales de los servicios existentes:
 * las solicitudes e incidencias son las del sistema (no filtradas por gestor).
 */
@Component({
  selector: 'app-gestor-home',
  standalone: true,
  imports: [EstadoBadge],
  templateUrl: './gestor-home.html',
  styleUrl: './gestor-home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GestorHome implements OnInit {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly revisionService = inject(RevisionService);
  private readonly practicaService = inject(PracticaService);

  protected readonly filtros = FILTROS;
  protected readonly plural = plural;
  protected readonly textoAntiguedad = textoAntiguedad;
  protected readonly formatearFecha = formatearFecha;
  protected readonly iniciales = iniciales;
  protected readonly nombre = computed(() => this.authStore.contexto()?.usuario.nombre ?? '');
  protected readonly fechaHoy = new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date());

  protected readonly solicitudes = signal<SolicitudRevisionResumen[]>([]);
  protected readonly cargandoSolicitudes = signal(true);
  protected readonly errorSolicitudes = signal('');
  protected readonly incidencias = signal<IncidenciaPractica[]>([]);
  protected readonly cargandoIncidencias = signal(true);
  protected readonly errorIncidencias = signal('');
  protected readonly sinPractica = signal<EstudianteSinPractica[]>([]);
  protected readonly cargandoSinPractica = signal(true);
  protected readonly errorSinPractica = signal('');
  protected readonly filtro = signal<FiltroSolicitud>('TODAS');
  protected readonly seleccionados = signal<number[]>([]);
  protected readonly confirmacionPendiente = signal<number[] | null>(null);
  protected readonly enviandoId = signal<number | null>(null);
  protected readonly resultados = signal<Record<number, ResultadoRecordatorio>>({});
  protected readonly resumenLote = signal('');

  private readonly seccionSinPractica = viewChild<ElementRef<HTMLElement>>('seccionSinPractica');

  protected readonly porRevisar = computed(() =>
    this.solicitudes().filter(solicitud => esPorRevisar(solicitud.estado))
  );
  protected readonly porRevisarAntiguas = computed(() =>
    this.porRevisar().filter(solicitud => (antiguedadDias(solicitud.fecha_registro) ?? 0) > 30).length
  );
  protected readonly observadas = computed(() =>
    this.solicitudes().filter(solicitud => normalizar(solicitud.estado) === 'OBSERVADA').length
  );
  protected readonly incidenciasAbiertas = computed(() => this.incidencias().filter(esAbierta));
  protected readonly incidenciasAltaPrioridad = computed(() =>
    this.incidenciasAbiertas().filter(incidencia => incidencia.prioridad === 'ALTA' || incidencia.prioridad === 'CRITICA').length
  );
  protected readonly incidenciasRecientes = computed(() =>
    [...this.incidenciasAbiertas()].sort((a, b) => marca(b.fecha) - marca(a.fecha)).slice(0, 5)
  );
  protected readonly solicitudesFiltradas = computed(() => {
    const filtroActual = this.filtro();
    return [...this.solicitudes()]
      .sort((a, b) => marca(a.fecha_registro) - marca(b.fecha_registro))
      .filter(solicitud => filtroActual === 'TODAS' || normalizar(solicitud.estado) === filtroActual);
  });
  protected readonly perfilIncompleto = computed(() =>
    this.sinPractica().filter(estudiante => !estudiante.tiene_perfil).length
  );
  protected readonly seleccionables = computed(() =>
    this.sinPractica().filter(estudiante => !estudiante.recordatorio_enviado_hoy).map(estudiante => estudiante.id_usuario)
  );
  protected readonly seleccionadosEnviables = computed(() =>
    this.seleccionados().filter(id => this.seleccionables().includes(id))
  );
  protected readonly todosSeleccionados = computed(() => {
    const disponibles = this.seleccionables();
    return disponibles.length > 0 && disponibles.every(id => this.seleccionados().includes(id));
  });
  protected readonly fallidos = computed(() =>
    Object.entries(this.resultados())
      .filter(([, resultado]) => resultado.error)
      .map(([id]) => Number(id))
      .filter(id => this.seleccionables().includes(id))
  );
  protected readonly etiquetaEnvio = computed(() => {
    const cantidad = this.seleccionadosEnviables().length;
    return cantidad > 0 ? `Enviar recordatorio a ${plural(cantidad, 'estudiante', 'estudiantes')}` : 'Enviar recordatorios';
  });
  protected readonly resumen = computed(() => {
    const partes: string[] = [];
    if (!this.cargandoSolicitudes() && !this.errorSolicitudes()) {
      partes.push(plural(this.porRevisar().length, 'solicitud por revisar', 'solicitudes por revisar'));
    }
    if (!this.cargandoIncidencias() && !this.errorIncidencias()) {
      partes.push(plural(this.incidenciasAbiertas().length, 'incidencia abierta', 'incidencias abiertas'));
    }
    if (!this.cargandoSinPractica() && !this.errorSinPractica()) {
      partes.push(plural(this.sinPractica().length, 'estudiante sin práctica registrada', 'estudiantes sin práctica registrada'));
    }
    if (partes.length > 0) {
      return partes.join(' · ');
    }
    const cargando = this.cargandoSolicitudes() || this.cargandoIncidencias() || this.cargandoSinPractica();
    return cargando ? 'Cargando el resumen del espacio…' : 'No fue posible cargar el resumen.';
  });

  ngOnInit(): void {
    this.recargar();
  }

  /** Vuelve a consultar los datos; lo usa Home al volver a la pantalla. */
  recargar(): void {
    this.cargarSolicitudes();
    this.cargarIncidencias();
    this.cargarSinPractica();
  }

  protected valorIndicador(cargando: boolean, error: string, valor: number): string {
    if (error) {
      return '—';
    }
    return cargando ? '…' : String(valor);
  }

  protected etiquetaPrioridad(prioridad: string): string {
    const etiquetas: Record<string, string> = { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', CRITICA: 'Crítica' };
    return etiquetas[prioridad] ?? prioridad;
  }

  protected etiquetaEstadoIncidencia(estado: string): string {
    return estado === 'EN_REVISION' ? 'En revisión' : 'Abierta';
  }

  protected motivoSinPractica(estudiante: EstudianteSinPractica): string {
    return estudiante.tiene_perfil ? 'Sin práctica registrada' : 'Falta completar su perfil';
  }

  protected conteoFiltro(valor: FiltroSolicitud): number {
    return valor === 'TODAS'
      ? this.solicitudes().length
      : this.solicitudes().filter(solicitud => normalizar(solicitud.estado) === valor).length;
  }

  protected elegirFiltro(valor: FiltroSolicitud): void {
    this.filtro.set(valor);
  }

  protected alternarSeleccion(id: number, evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.seleccionados.update(ids => marcado
      ? [...new Set([...ids, id])]
      : ids.filter(actual => actual !== id));
  }

  protected alternarTodos(evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.seleccionados.set(marcado ? [...this.seleccionables()] : []);
  }

  /** Un solo envío se realiza directo; varios requieren confirmación explícita. */
  protected enviarSeleccionados(): void {
    this.solicitarEnvio(this.seleccionadosEnviables());
  }

  protected reintentarFallidos(): void {
    this.solicitarEnvio(this.fallidos());
  }

  protected confirmarEnvio(): void {
    const ids = this.confirmacionPendiente();
    this.confirmacionPendiente.set(null);
    if (ids) {
      this.enviarLote(ids);
    }
  }

  protected cancelarEnvio(): void {
    this.confirmacionPendiente.set(null);
  }

  protected irA(ruta: string): void {
    void this.router.navigate([ruta]);
  }

  protected abrirRevisiones(): void {
    void this.router.navigate(['/revisiones']);
  }

  protected abrirSolicitud(idPractica: number): void {
    void this.router.navigate(['/revisiones', idPractica]);
  }

  protected abrirNuevoAviso(): void {
    void this.router.navigate(['/envio-notificaciones']);
  }

  protected irASinPractica(): void {
    this.seccionSinPractica()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private cargarSolicitudes(): void {
    this.cargandoSolicitudes.set(true);
    this.errorSolicitudes.set('');
    this.revisionService.listar().subscribe({
      next: solicitudes => {
        this.solicitudes.set(solicitudes);
        this.cargandoSolicitudes.set(false);
      },
      error: () => {
        this.errorSolicitudes.set('No fue posible cargar las solicitudes por revisar.');
        this.cargandoSolicitudes.set(false);
      }
    });
  }

  private cargarIncidencias(): void {
    this.cargandoIncidencias.set(true);
    this.errorIncidencias.set('');
    this.practicaService.listarIncidencias().subscribe({
      next: incidencias => {
        this.incidencias.set(incidencias);
        this.cargandoIncidencias.set(false);
      },
      error: () => {
        this.errorIncidencias.set('No fue posible cargar las incidencias.');
        this.cargandoIncidencias.set(false);
      }
    });
  }

  private cargarSinPractica(): void {
    this.cargandoSinPractica.set(true);
    this.errorSinPractica.set('');
    this.practicaService.listarEstudiantesSinPractica().subscribe({
      next: estudiantes => {
        this.sinPractica.set(estudiantes);
        this.seleccionados.update(ids => ids.filter(id => this.seleccionables().includes(id)));
        this.cargandoSinPractica.set(false);
      },
      error: () => {
        this.errorSinPractica.set('No fue posible consultar los estudiantes sin práctica registrada.');
        this.cargandoSinPractica.set(false);
      }
    });
  }

  private solicitarEnvio(ids: number[]): void {
    if (ids.length === 0 || this.enviandoId() !== null) {
      return;
    }
    if (ids.length > 1) {
      this.confirmacionPendiente.set(ids);
      return;
    }
    this.enviarLote(ids);
  }

  /** Envío secuencial: un recordatorio por estudiante, resultados individuales y sin reenvíos duplicados. */
  private enviarLote(ids: number[]): void {
    this.resumenLote.set('');
    from(ids).pipe(
      concatMap(id => {
        this.enviandoId.set(id);
        return this.practicaService.enviarRecordatorioEstudiante(id).pipe(
          map((respuesta): RespuestaRecordatorio => ({ id, ok: true, mensaje: respuesta.mensaje })),
          catchError((error: HttpErrorResponse) => of<RespuestaRecordatorio>({ id, ok: false, mensaje: detalleError(error) }))
        );
      })
    ).subscribe({
      next: respuesta => {
        this.resultados.update(actuales => ({
          ...actuales,
          [respuesta.id]: { mensaje: respuesta.mensaje, error: !respuesta.ok }
        }));
        if (respuesta.ok) {
          this.seleccionados.update(ids => ids.filter(actual => actual !== respuesta.id));
        }
      },
      complete: () => {
        this.enviandoId.set(null);
        const fallidosLote = ids.filter(id => this.resultados()[id]?.error).length;
        const enviados = ids.length - fallidosLote;
        const resumen = plural(enviados, 'recordatorio enviado', 'recordatorios enviados');
        this.resumenLote.set(fallidosLote > 0
          ? `${resumen}. ${plural(fallidosLote, 'envío fallido', 'envíos fallidos')}.`
          : `${resumen}.`);
        this.cargarSinPractica();
      }
    });
  }
}
