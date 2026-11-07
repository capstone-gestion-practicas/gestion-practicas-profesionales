import { ChangeDetectionStrategy, Component, Injector, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { Informe, InformeService } from './informe.service';

@Component({ selector: 'app-informe-final', standalone: true,
  templateUrl: './informe-final.html', styleUrl: './informe-final.scss',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class InformeFinal implements OnChanges, OnDestroy {
  @Input({ required: true }) idPractica!: number;
  @Input() estudiante = false;
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
    this.informe.set(null); this.archivo = null; this.key = null; this.versionEnvio = null;
    this.abierto.set(false); this.cargando.set(false); this.enviando.set(false);
    this.error.set(''); this.mensaje.set(''); this.progreso.set(null);
  }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); }
  cargar(): void {
    if (this.cargando() || this.enviando()) return;
    this.abierto.set(true); this.cargando.set(true); this.error.set('');
    this.subscriptions.add(this.api().consultar(this.idPractica).subscribe({
      next: informe => { this.informe.set(informe); this.cargando.set(false); },
      error: (e: HttpErrorResponse) => { this.cargando.set(false); this.mostrarError(e); }
    }));
  }
  seleccionar(event: Event): void {
    if (!(event.target instanceof HTMLInputElement) || this.enviando()) return;
    this.archivo = event.target.files?.[0] ?? null; this.key = null; this.versionEnvio = null;
    this.error.set(''); this.mensaje.set('');
    if (this.archivo && (!this.archivo.name.toLowerCase().endsWith('.pdf') || this.archivo.size === 0 || this.archivo.size > 10485760)) {
      this.error.set('Selecciona un PDF no vacío de máximo 10 MiB.'); this.archivo = null;
    }
  }
  entregar(): void {
    const informe = this.informe();
    if (this.enviando() || !this.estudiante || !this.archivo || !informe?.habilitada) return;
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
    if (this.cargando() || this.enviando() || !this.informe()?.id_documento) return;
    this.cargando.set(true); this.error.set('');
    this.subscriptions.add(this.api().descargar(this.idPractica).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob); const link = document.createElement('a');
        link.href = url; link.download = 'informe-final.pdf'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); this.cargando.set(false);
      }, error: (e: HttpErrorResponse) => { this.cargando.set(false); this.mostrarError(e); }
    }));
  }
  private mostrarError(e: HttpErrorResponse): void {
    this.error.set(e.status === 403 ? 'No tienes acceso académico al informe.'
      : e.status === 409 ? 'La entrega cambió o ya no está habilitada. Actualiza la información; para otra entrega vuelve a seleccionar el archivo.'
      : e.status === 413 ? 'El máximo permitido es 10 MiB.'
      : e.status === 422 ? 'PDF inválido, cifrado o con contenido no permitido.'
      : e.status === 404 ? 'No hay un informe disponible.'
      : 'No fue posible completar la operación. Puedes reintentar.');
  }
}
