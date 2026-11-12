import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthStore } from '../../../core/store/auth.store';
import { PracticaService } from '../../../core/services/practica.service';
import { RevisionService } from '../../../core/services/revision.service';
import { esPorRevisar } from '../../../core/services/solicitudes-pendientes.service';
import { EstudianteSinPractica, IncidenciaPractica } from '../../../core/models/practica.models';
import { SolicitudRevisionResumen } from '../../../core/models/revision.models';
import { EstadoBadge } from '../../../shared/components/estado-badge/estado-badge';
import { esIncidenciaPendiente } from '../../../core/models/incidencia-pendiente';

const marca = (fecha: string): number => Date.parse(fecha) || 0;
const dias = (fecha: string): number => Number.isFinite(Date.parse(fecha))
  ? Math.floor((Date.now() - marca(fecha)) / 86_400_000) : 0;
const normalizar = (estado: string): string => estado.trim().toUpperCase();

/** Inicio resume datos existentes; los listados y envíos viven en sus módulos. */
@Component({
  selector: 'app-gestor-home', standalone: true, imports: [EstadoBadge],
  templateUrl: './gestor-home.html', styleUrl: './gestor-home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GestorHome {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly revisiones = inject(RevisionService);
  private readonly practicas = inject(PracticaService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly nombre = computed(() => this.auth.contexto()?.usuario.nombre ?? '');
  protected readonly fechaHoy = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  protected readonly solicitudes = signal<SolicitudRevisionResumen[]>([]);
  protected readonly incidencias = signal<IncidenciaPractica[]>([]);
  protected readonly sinPractica = signal<EstudianteSinPractica[]>([]);
  protected readonly cargandoSolicitudes = signal(true);
  protected readonly cargandoIncidencias = signal(true);
  protected readonly cargandoSinPractica = signal(true);
  protected readonly errorSolicitudes = signal('');
  protected readonly errorIncidencias = signal('');
  protected readonly errorSinPractica = signal('');
  protected readonly porRevisar = computed(() => this.solicitudes().filter(s => esPorRevisar(s.estado)));
  protected readonly porRevisarAntiguas = computed(() => this.porRevisar().filter(s => dias(s.fecha_registro) > 30).length);
  protected readonly observadas = computed(() => this.solicitudes().filter(s => normalizar(s.estado) === 'OBSERVADA').length);
  protected readonly incidenciasAbiertas = computed(() => this.incidencias().filter(esIncidenciaPendiente));
  protected readonly incidenciasAltaPrioridad = computed(() => this.incidenciasAbiertas().filter(i => ['ALTA', 'CRITICA'].includes(i.prioridad)).length);
  protected readonly incidenciasRecientes = computed(() => [...this.incidenciasAbiertas()].sort((a, b) => marca(b.fecha) - marca(a.fecha)).slice(0, 5));
  protected readonly solicitudesFiltradas = computed(() => [...this.solicitudes()]
    .filter(s => esPorRevisar(s.estado) || normalizar(s.estado) === 'OBSERVADA')
    .sort((a, b) => marca(a.fecha_registro) - marca(b.fecha_registro)).slice(0, 5));
  protected readonly perfilIncompleto = computed(() => this.sinPractica().filter(e => !e.tiene_perfil).length);
  protected readonly resumen = computed(() => {
    const partes: string[] = [];
    if (!this.cargandoSolicitudes() && !this.errorSolicitudes()) partes.push(this.plural(this.porRevisar().length, 'solicitud por revisar', 'solicitudes por revisar'));
    if (!this.cargandoIncidencias() && !this.errorIncidencias()) partes.push(this.plural(this.incidenciasAbiertas().length, 'incidencia abierta', 'incidencias abiertas'));
    if (!this.cargandoSinPractica() && !this.errorSinPractica()) partes.push(this.plural(this.sinPractica().length, 'estudiante sin práctica registrada', 'estudiantes sin práctica registrada'));
    return partes.length ? partes.join(' · ') : this.cargandoSolicitudes() || this.cargandoIncidencias() || this.cargandoSinPractica()
      ? 'Cargando el resumen del espacio…' : 'No fue posible cargar el resumen.';
  });
  ngOnInit(): void { this.recargar(); }
  recargar(): void {
    this.cargandoSolicitudes.set(true); this.errorSolicitudes.set('');
    this.revisiones.listar().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: datos => { this.solicitudes.set(datos); this.cargandoSolicitudes.set(false); },
      error: () => { this.errorSolicitudes.set('No fue posible cargar las solicitudes por revisar.'); this.cargandoSolicitudes.set(false); }
    });
    this.cargandoIncidencias.set(true); this.errorIncidencias.set('');
    this.practicas.listarIncidencias().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: datos => { this.incidencias.set(datos); this.cargandoIncidencias.set(false); },
      error: () => { this.errorIncidencias.set('No fue posible cargar las incidencias.'); this.cargandoIncidencias.set(false); }
    });
    this.cargandoSinPractica.set(true); this.errorSinPractica.set('');
    this.practicas.listarEstudiantesSinPractica().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: datos => { this.sinPractica.set(datos); this.cargandoSinPractica.set(false); },
      error: () => { this.errorSinPractica.set('No fue posible consultar los estudiantes sin práctica registrada.'); this.cargandoSinPractica.set(false); }
    });
  }
  protected plural(n: number, singular: string, plural: string): string { return `${n} ${n === 1 ? singular : plural}`; }
  protected valorIndicador(cargando: boolean, error: string, valor: number): string { return error ? '—' : cargando ? '…' : String(valor); }
  protected textoAntiguedad(fecha: string): string {
    if (!Number.isFinite(Date.parse(fecha))) return '';
    const n = dias(fecha); return n <= 0 ? 'hoy' : `hace ${this.plural(n, 'día', 'días')}`;
  }
  protected formatearFecha(fecha: string): string {
    return Number.isFinite(Date.parse(fecha)) ? new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(fecha)) : '';
  }
  protected iniciales(nombre: string): string { return nombre.split(' ').filter(Boolean).slice(0, 2).map(p => p.charAt(0).toUpperCase()).join(''); }
  protected etiquetaPrioridad(prioridad: string): string { return ({ BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', CRITICA: 'Crítica' } as Record<string, string>)[prioridad] ?? prioridad; }
  protected etiquetaEstadoIncidencia(estado: string): string {
    return ({ EN_REVISION: 'En revisión', EN_ATENCION: 'En atención', PENDIENTE: 'Pendiente', ABIERTA: 'Abierta' } as Record<string, string>)[estado] ?? estado;
  }
  protected irA(ruta: string): void { void this.router.navigate([ruta]); }
  protected abrirRevisiones(): void { this.irA('/revisiones'); }
  protected abrirObservadas(): void { void this.router.navigate(['/revisiones'], { queryParams: { estado: 'OBSERVADA' } }); }
  protected abrirSolicitud(id: number): void { void this.router.navigate(['/revisiones', id]); }
  protected abrirNuevoAviso(): void { this.irA('/envio-notificaciones'); }
  protected irASinPractica(): void { void this.router.navigate(['/envio-notificaciones'], { fragment: 'recordatorios' }); }
}
