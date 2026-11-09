import { EvaluacionPanel } from '../evaluaciones/evaluacion-panel';
import { ConsultaAcademica, EvaluacionService, aprobacionVigente } from '../evaluaciones/evaluacion.service';
import { ChangeDetectionStrategy, Component, Injector, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Subscription, forkJoin } from 'rxjs';
import { Informe, InformeService, errorArchivo } from './informe.service';

@Component({ selector: 'app-informe-final', standalone: true,
  imports: [EvaluacionPanel], templateUrl: './informe-final.html', styleUrl: './informe-final.scss',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class InformeFinal implements OnChanges, OnDestroy {
  @Input({ required: true }) idPractica!: number;
  @Input() estudiante = false;
  @Input() docente = false;
  readonly academico = signal<ConsultaAcademica | null>(null);
  readonly evaluando = signal(false);
  puedeEntregar(): boolean {
    const informe = this.informe(); const estado = this.academico();
    return !!informe?.habilitada && !this.evaluando() && !!estado && estado.id_documento === informe.id_documento
      && estado.version === informe.version && !estado.evaluacion_pendiente
      && estado.estado_informe !== 'EN_EVALUACION' && !aprobacionVigente(estado);
  }
  private readonly injector = inject(Injector);
  private subscriptions = new Subscription();
  private api(): InformeService { return this.injector.get(InformeService); }
  readonly informe = signal<Informe | null>(null);
  readonly abierto = signal(false);
  readonly cargando = signal(false);
  readonly enviando = signal(false);
  readonly progreso = signal<number | null>(null);
  readonly error = signal('');
  readonly mensaje = signal('');
  archivo: File | null = null;
  private key: string | null = null;
  private versionEnvio: number | null = null;
  ngOnChanges(): void {
    this.subscriptions.unsubscribe(); this.subscriptions = new Subscription();
    this.academico.set(null); this.evaluando.set(false);
    this.informe.set(null); this.archivo = null; this.key = null; this.versionEnvio = null;
    this.abierto.set(false); this.cargando.set(false); this.enviando.set(false);
    this.error.set(''); this.mensaje.set(''); this.progreso.set(null);
  }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); }
  cargar(): void {
    if (this.cargando() || this.enviando() || this.evaluando()) return;
    this.academico.set(null); this.informe.set(null);
    this.abierto.set(true); this.cargando.set(true); this.error.set('');
    this.subscriptions.add(forkJoin({
      informe: this.api().consultar(this.idPractica),
      academico: this.injector.get(EvaluacionService).consultar(this.idPractica)
    }).subscribe({
      next: ({ informe, academico }) => {
        this.informe.set(informe); this.academico.set(academico); this.cargando.set(false);
      },
      error: (e: HttpErrorResponse) => { this.cargando.set(false); this.mostrarError(e); }
    }));
  }
  refrescarInforme(): void {
    this.abierto.set(true); this.cargando.set(true); this.error.set('');
    this.subscriptions.add(this.api().consultar(this.idPractica).subscribe({
      next: informe => { this.informe.set(informe); this.cargando.set(false); },
      error: (e: HttpErrorResponse) => { this.informe.set(null); this.cargando.set(false); this.mostrarError(e); }
    }));
  }
  seleccionar(event: Event): void {
    if (!(event.target instanceof HTMLInputElement) || this.enviando()) return;
    this.archivo = event.target.files?.[0] ?? null; this.key = null; this.versionEnvio = null;
    this.error.set(''); this.mensaje.set('');
    if (this.archivo) {
      const error = errorArchivo(this.archivo);
      if (error) {
        this.error.set(error); this.archivo = null; event.target.value = '';
      }
    }
  }

  entregar(): void {
    const informe = this.informe();
    if (this.enviando() || !this.estudiante || !this.archivo || !informe || !this.puedeEntregar() || this.evaluando()) return;
    const error = errorArchivo(this.archivo);
    if (error) { this.error.set(error); return; }
    this.key ??= crypto.randomUUID(); this.versionEnvio ??= informe.version;
    this.enviando.set(true); this.progreso.set(null); this.error.set(''); this.mensaje.set('');
    this.subscriptions.add(this.api().entregar(this.idPractica, this.archivo, this.key, this.versionEnvio).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress) this.progreso.set(event.total ? Math.round(event.loaded / event.total * 100) : null);
        if (event.type === HttpEventType.Response) {
          this.enviando.set(false); this.archivo = null; this.key = null; this.versionEnvio = null;
          this.mensaje.set('Informe entregado. La entrega no implica aprobación ni cierre.'); this.cargar();
        }
      },
      error: (e: HttpErrorResponse) => { this.enviando.set(false); this.mostrarError(e); }
    }));
  }
  descargar(): void {
    if (this.cargando() || this.enviando() || this.evaluando() || !this.informe()?.id_documento) return;
    this.cargando.set(true); this.error.set('');
    this.subscriptions.add(this.api().descargar(this.idPractica).subscribe({
      next: archivo => {
        const url = URL.createObjectURL(archivo.blob); const link = document.createElement('a');
        link.href = url; link.download = archivo.nombre; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); this.cargando.set(false);
      }, error: (e: HttpErrorResponse) => { this.cargando.set(false); this.mostrarError(e); }
    }));
  }
  private mostrarError(e: HttpErrorResponse): void {
    const body: unknown = e.error;
    const storageNoDisponible = e.status === 503 && typeof body === 'object' && body !== null
      && 'detail' in body && body.detail === 'El formato todavía no está habilitado en Storage';
    this.error.set(storageNoDisponible ? 'DOCX todavía no está disponible en el almacenamiento. Puedes entregar un PDF o reintentar más tarde con la misma clave.'
      : e.status === 401 ? 'Tu sesión no es válida. Inicia sesión nuevamente.'
      : e.status === 403 ? 'No tienes acceso académico al informe.'
      : e.status === 409 ? 'La entrega cambió o ya no está habilitada. Actualiza la información; para otra entrega vuelve a seleccionar el archivo.'
      : e.status === 413 ? 'El máximo permitido es 10 MiB.'
      : e.status === 415 ? 'Formato no admitido. Selecciona PDF o DOCX Transitional.'
      : e.status === 422 ? 'Informe inválido, cifrado o con contenido no permitido. Solo se admiten PDF y DOCX Transitional.'
      : e.status === 429 ? 'La validación está ocupada. Espera y reintenta la misma entrega.'
      : e.status === 503 ? 'El validador o el almacenamiento no está disponible. Puedes reintentar la misma entrega; DOCX requiere estar habilitado en el almacenamiento.'
      : e.status === 404 ? 'No hay un informe disponible.'
      : 'No fue posible completar la operación. Puedes reintentar.');
  }
}
