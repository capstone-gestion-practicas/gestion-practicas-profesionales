import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, concatMap, from, map, of } from 'rxjs';
import { EstudianteSinPractica } from '../../../core/models/practica.models';
import { PracticaService } from '../../../core/services/practica.service';

/** Flujo de recordatorios extraído de GestorHome: mismo endpoint, confirmación y envío secuencial. */
@Component({
  selector: 'app-recordatorios-estudiantes', standalone: true,
  templateUrl: './recordatorios-estudiantes.html',
  styleUrl: '../../../pages/home/gestor-home/gestor-home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RecordatoriosEstudiantes {
  private readonly api = inject(PracticaService);
  private readonly destroyRef = inject(DestroyRef);
  readonly estudiantes = signal<EstudianteSinPractica[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly seleccionados = signal<number[]>([]);
  readonly confirmacionPendiente = signal<number[] | null>(null);
  readonly enviando = signal(false);
  readonly resultados = signal<Record<number, { mensaje: string; error: boolean }>>({});
  readonly resumenLote = signal('');
  readonly seleccionables = computed(() => this.estudiantes()
    .filter(e => !e.recordatorio_enviado_hoy && !this.enviados().has(e.id_usuario)).map(e => e.id_usuario));
  readonly enviables = computed(() => this.seleccionados().filter(id => this.seleccionables().includes(id)));
  readonly todosSeleccionados = computed(() => this.seleccionables().length > 0
    && this.seleccionables().every(id => this.seleccionados().includes(id)));
  readonly fallidos = computed(() => Object.entries(this.resultados())
    .filter(([, r]) => r.error).map(([id]) => Number(id)).filter(id => this.seleccionables().includes(id)));
  private readonly enviados = signal<ReadonlySet<number>>(new Set());

  ngOnInit(): void { this.cargar(); }
  plural(n: number, singular: string, plural: string): string { return `${n} ${n === 1 ? singular : plural}`; }
  bloqueado(e: EstudianteSinPractica): boolean { return e.recordatorio_enviado_hoy || this.enviados().has(e.id_usuario); }
  cargar(): void {
    this.cargando.set(true); this.error.set('');
    this.api.listarEstudiantesSinPractica().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: datos => {
        this.estudiantes.set(datos);
        this.seleccionados.update(ids => ids.filter(id => this.seleccionables().includes(id)));
        this.cargando.set(false);
      },
      error: () => { this.error.set('No fue posible consultar los estudiantes sin práctica registrada.'); this.cargando.set(false); }
    });
  }
  seleccionar(id: number, evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.seleccionados.update(ids => marcado ? [...new Set([...ids, id])] : ids.filter(valor => valor !== id));
  }
  seleccionarTodos(evento: Event): void {
    this.seleccionados.set((evento.target as HTMLInputElement).checked ? [...this.seleccionables()] : []);
  }
  solicitar(ids = this.enviables()): void {
    if (this.enviando() || this.confirmacionPendiente() !== null || !ids.length) return;
    if (ids.length > 1) this.confirmacionPendiente.set([...ids]);
    else this.enviar(ids);
  }
  confirmar(): void {
    const ids = this.confirmacionPendiente();
    this.confirmacionPendiente.set(null);
    if (ids && !this.enviando()) this.enviar(ids.filter(id => this.seleccionables().includes(id)));
  }
  private enviar(ids: number[]): void {
    if (!ids.length || this.enviando()) return;
    this.enviando.set(true); this.resumenLote.set('');
    from(ids).pipe(concatMap(id => this.api.enviarRecordatorioEstudiante(id).pipe(
      map(r => ({ id, ok: true, mensaje: r.mensaje })),
      catchError((e: HttpErrorResponse) => of({ id, ok: false, mensaje: typeof e.error?.detail === 'string'
        ? e.error.detail : 'No fue posible enviar el recordatorio.' }))
    )), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => {
        if (r.ok) {
          this.enviados.update(ids => new Set([...ids, r.id]));
          this.seleccionados.update(ids => ids.filter(id => id !== r.id));
        }
        this.resultados.update(datos => ({ ...datos, [r.id]: { mensaje: r.mensaje, error: !r.ok } }));
      },
      complete: () => {
        if (this.destroyRef.destroyed) return;
        this.enviando.set(false);
        const fallidos = ids.filter(id => this.resultados()[id]?.error).length;
        this.resumenLote.set(`${this.plural(ids.length - fallidos, 'recordatorio enviado', 'recordatorios enviados')}.${fallidos
          ? ` ${this.plural(fallidos, 'envío fallido', 'envíos fallidos')}.` : ''}`);
        this.cargar();
      }
    });
  }
}
