import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ConsultaAcademica, EvaluacionService, ResolucionAcademica, ResultadoAcademico, aprobacionVigente } from './evaluacion.service';

@Component({
  selector: 'app-evaluacion-panel', standalone: true, imports: [DatePipe, FormsModule],
  templateUrl: './evaluacion-panel.html', styleUrl: './evaluacion-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EvaluacionPanel implements OnChanges, OnDestroy {
  @Input({ required: true }) idPractica!: number;
  @Input() docente = false;
  @Input() estudiante = false;
  @Input() inicial: ConsultaAcademica | null = null;
  @Input() cargaExterna = false;
  @Output() estado = new EventEmitter<ConsultaAcademica | null>();
  @Output() cambio = new EventEmitter<void>();
  @Output() ocupado = new EventEmitter<boolean>();
  private readonly api = inject(EvaluacionService);
  private subscriptions = new Subscription();
  private practicaAnterior: number | null = null;
  private readonly intentos = new Map<string, string>();
  private consulta?: Subscription;
  readonly datos = signal<ConsultaAcademica | null>(null);
  readonly cargando = signal(false);
  readonly enviando = signal(false);
  readonly error = signal('');
  readonly mensaje = signal('');
  readonly bloqueado = signal(false);
  resultado: ResultadoAcademico = 'APROBADO';
  observaciones = '';
  readonly aprobacionVigente = aprobacionVigente;
  ngOnChanges(): void {
    if (this.practicaAnterior !== this.idPractica) {
      this.subscriptions.unsubscribe(); this.subscriptions = new Subscription();
      this.practicaAnterior = this.idPractica; this.intentos.clear();
      this.observaciones = ''; this.resultado = 'APROBADO';
      this.enviando.set(false); this.ocupado.emit(false); this.mensaje.set('');
    }
    if (this.cargaExterna) {
      this.datos.set(this.inicial);
      if (this.inicial) { this.error.set(''); this.bloqueado.set(false); }
      return;
    }
    this.cargar();
  }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); }
  cargar(): void {
    if (this.enviando()) return;
    this.consulta?.unsubscribe();
    this.datos.set(null); this.estado.emit(null); this.error.set('');
    this.bloqueado.set(false); this.cargando.set(true);
    this.consulta = this.api.consultar(this.idPractica).subscribe({
      next: datos => { this.datos.set(datos); this.estado.emit(datos); this.cargando.set(false); },
      error: (error: HttpErrorResponse) => { this.cargando.set(false); this.mostrarError(error); }
    });
    this.subscriptions.add(this.consulta);
  }
  puedeIniciar(): boolean {
    const datos = this.datos();
    return this.docente && !this.bloqueado() && !this.cargando() && !this.enviando()
      && !!datos?.id_documento && datos.estado_informe === 'ENTREGADO'
      && !datos.evaluacion_pendiente && !datos.resultado_vigente;
  }
  puedeResolver(): boolean {
    return this.docente && !this.bloqueado() && !this.cargando() && !this.enviando()
      && !!this.datos()?.evaluacion_pendiente;
  }
  iniciar(): void {
    const datos = this.datos();
    if (!this.puedeIniciar() || !datos?.id_documento) return;
    const key = this.clave(JSON.stringify(['inicio', this.idPractica, datos.id_documento, datos.version]));
    this.preparar();
    this.subscriptions.add(this.api.iniciar(this.idPractica, datos.id_documento, datos.version, key).subscribe({
      next: () => this.confirmada('Evaluación iniciada. El PDF queda bloqueado durante la evaluación.'),
      error: (error: HttpErrorResponse) => this.fallo(error)
    }));
  }
  resolver(): void {
    const evaluacion = this.datos()?.evaluacion_pendiente;
    if (!this.puedeResolver() || !evaluacion) return;
    if (Array.from(this.observaciones).length > 2000 || this.observaciones.includes('\0')
      || (this.resultado === 'CON_OBSERVACIONES' && !this.observaciones.trim())) {
      this.error.set('CON_OBSERVACIONES requiere observaciones no vacías. Máximo 2.000 caracteres y sin caracteres nulos.'); return;
    }
    const datos: ResolucionAcademica = { resultado: this.resultado, observaciones: this.observaciones.trim() || null };
    const key = this.clave(JSON.stringify(['resolucion', this.idPractica, evaluacion.id_evaluacion, datos]));
    this.preparar();
    this.subscriptions.add(this.api.resolver(this.idPractica, evaluacion.id_evaluacion, datos, key).subscribe({
      next: () => this.confirmada('Resultado registrado. La aprobación académica no cierra la práctica.'),
      error: (error: HttpErrorResponse) => this.fallo(error)
    }));
  }
  private clave(contenido: string): string {
    const existente = this.intentos.get(contenido);
    if (existente) return existente;
    const key = crypto.randomUUID(); this.intentos.set(contenido, key); return key;
  }
  private preparar(): void { this.enviando.set(true); this.ocupado.emit(true); this.error.set(''); this.mensaje.set(''); }
  private confirmada(mensaje: string): void {
    this.enviando.set(false); this.ocupado.emit(false); this.intentos.clear();
    this.observaciones = ''; this.mensaje.set(mensaje); this.cargar(); this.cambio.emit();
  }
  private fallo(error: HttpErrorResponse): void {
    this.enviando.set(false); this.ocupado.emit(false); this.mostrarError(error);
  }
  private mostrarError(error: HttpErrorResponse): void {
    const mensajes: Record<number, string> = {
      400: 'Revisa el resultado y las observaciones (máximo 2.000 caracteres).',
      401: 'Tu sesión no es válida. Inicia sesión nuevamente.',
      403: 'Ya no tienes autorización o la práctica no permite esta operación. Actualiza la información.',
      404: 'La práctica o su evaluación ya no está disponible para tu cuenta.',
      409: 'La versión, asignación o evaluación cambió. Actualiza antes de volver a actuar.'
    };
    this.error.set(mensajes[error.status] ?? 'No se pudo confirmar la operación. Puedes reintentar la misma operación.');
    if ([401, 403, 404, 409].includes(error.status)) {
      this.datos.set(null); this.estado.emit(null); this.bloqueado.set(true);
    }
  }
}
