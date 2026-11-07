import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router } from '@angular/router';
import {
  IonButton, IonCard, IonCardContent, IonContent, IonGrid, IonCol, IonRow, IonSpinner
} from '@ionic/angular';

import { esEspacioGestorDedicado } from '../../core/navigation/espacio-gestor';
import { SolicitudRevisionResumen } from '../../core/models/revision.models';
import { RevisionService } from '../../core/services/revision.service';
import { SolicitudesPendientesService } from '../../core/services/solicitudes-pendientes.service';
import { AuthStore } from '../../core/store/auth.store';
import { EstadoBadge } from '../../shared/components/estado-badge/estado-badge';
import {
  EstadoSolicitud,
  ESTADOS_SOLICITUD,
  ORDENES_SOLICITUDES,
  OrdenSolicitudes,
  antiguedadDias,
  contarPorEstado,
  contarPorRevisar,
  estadosDesdeParametro,
  fechaEnvio,
  filtrarSolicitudes,
  ordenDesdeParametro,
  ordenarSolicitudes,
  paginaDesdeParametro,
  paginar,
  parametroDesdeEstados,
  parametroDesdeOrden
} from './solicitudes-listado';

/**
 * Listado de solicitudes del gestor. Una sola petición por entrada a la página; filtros,
 * búsqueda, orden y paginación son locales. El filtro de estado vive en la URL (?estado=).
 */
@Component({
  selector: 'app-revisiones',
  standalone: true,
  imports: [
    IonButton, IonCard, IonCardContent, IonContent, IonGrid, IonCol, IonRow, IonSpinner, EstadoBadge
  ],
  templateUrl: './revisiones.html',
  styleUrl: './revisiones.scss'
})
export class Revisiones implements OnInit {
  private readonly authStore = inject(AuthStore);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pendientes = inject(SolicitudesPendientesService);
  private readonly datos = signal<SolicitudRevisionResumen[]>([]);

  cargando = true;
  error = '';

  readonly busqueda = signal('');
  readonly estados = signal<EstadoSolicitud[]>([]);
  readonly estadosDesconocidos = signal<string[]>([]);
  readonly orden = signal<OrdenSolicitudes>('ANTIGUAS');
  private readonly paginaSolicitada = signal(1);

  readonly opcionesOrden = ORDENES_SOLICITUDES;
  readonly opcionesEstado: ReadonlyArray<{ estado: EstadoSolicitud; etiqueta: string }> = [
    { estado: 'REGISTRADA', etiqueta: 'Registradas' },
    { estado: 'EN_REVISION', etiqueta: 'En revisión' },
    { estado: 'OBSERVADA', etiqueta: 'Observadas' }
  ];

  /** Listado completo tal como lo devuelve el servicio. */
  get solicitudes(): SolicitudRevisionResumen[] {
    return this.datos();
  }

  readonly conteos = computed(() => contarPorEstado(this.datos()));
  /** Por revisar = REGISTRADA + EN_REVISION; coincide con el contador del sidebar. */
  readonly porRevisar = computed(() => contarPorRevisar(this.datos()));
  readonly filtradas = computed(() =>
    ordenarSolicitudes(filtrarSolicitudes(this.datos(), this.estados(), this.busqueda()), this.orden())
  );
  readonly pagina = computed(() => paginar(this.filtradas(), this.paginaSolicitada()));

  constructor(
    private readonly revisionService: RevisionService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    // La URL es la fuente del estado del listado: estado, búsqueda, orden y página.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const filtro = estadosDesdeParametro(params.get('estado'));
      this.estados.set(filtro.estados);
      this.estadosDesconocidos.set(filtro.desconocidos);
      this.busqueda.set(params.get('q') ?? '');
      this.orden.set(ordenDesdeParametro(params.get('orden')));
      this.paginaSolicitada.set(paginaDesdeParametro(params.get('pagina')));
    });
    this.cargar();
  }

  cargar(): void {
    this.cargando = true;
    this.error = '';
    this.revisionService.listar().subscribe({
      next: solicitudes => {
        this.datos.set(solicitudes);
        this.pendientes.publicar(solicitudes);
        this.cargando = false;
      },
      error: () => {
        this.error = 'No fue posible cargar las solicitudes.';
        this.cargando = false;
      }
    });
  }

  alBuscar(valor: string): void {
    this.busqueda.set(valor);
    this.paginaSolicitada.set(1);
  }

  alOrdenar(valor: string): void {
    const orden = ORDENES_SOLICITUDES.find(opcion => opcion.valor === valor)?.valor;
    if (orden) {
      this.orden.set(orden);
      this.paginaSolicitada.set(1);
      this.sincronizarUrl();
    }
  }

  /** Confirma la búsqueda en la URL (al salir del campo o al pulsar Intro). */
  confirmarBusqueda(): void {
    this.sincronizarUrl();
  }

  mostrarTodas(): void {
    this.aplicarEstados([]);
  }

  /** Activa o desactiva un estado. Sin ninguno seleccionado se muestran todas. */
  alternarEstado(estado: EstadoSolicitud): void {
    const actuales = this.estados();
    const siguientes = actuales.includes(estado)
      ? actuales.filter(item => item !== estado)
      : ESTADOS_SOLICITUD.filter(item => item === estado || actuales.includes(item));
    this.aplicarEstados(siguientes);
  }

  limpiarFiltros(): void {
    this.busqueda.set('');
    this.aplicarEstados([]);
  }

  paginaAnterior(): void {
    this.paginaSolicitada.set(Math.max(1, this.pagina().pagina - 1));
    this.sincronizarUrl();
  }

  paginaSiguiente(): void {
    this.paginaSolicitada.set(Math.min(this.pagina().paginas, this.pagina().pagina + 1));
    this.sincronizarUrl();
  }

  antiguedad(solicitud: SolicitudRevisionResumen): string {
    const dias = antiguedadDias(solicitud);
    if (dias === null) return 'Sin fecha';
    return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
  }

  fechaEnvio(solicitud: SolicitudRevisionResumen): string {
    return fechaEnvio(solicitud);
  }

  valorDe(evento: Event): string {
    return (evento.target as HTMLInputElement | HTMLSelectElement).value;
  }

  /** Abre el detalle conservando estado, búsqueda, orden y página para volver al mismo listado. */
  revisar(idPractica: number): void {
    this.router.navigate(['/revisiones', idPractica], { queryParams: this.parametrosListado() });
  }

  /** Parámetros de la URL que describen el listado actual; los valores por defecto no se escriben. */
  parametrosListado(): Params {
    const params: Params = {};
    const estado = parametroDesdeEstados(this.estados());
    if (estado) params['estado'] = estado;
    const busqueda = this.busqueda().trim();
    if (busqueda) params['q'] = busqueda;
    const orden = parametroDesdeOrden(this.orden());
    if (orden) params['orden'] = orden;
    if (this.pagina().pagina > 1) params['pagina'] = this.pagina().pagina;
    return params;
  }

  mostrarVolver(): boolean {
    return !esEspacioGestorDedicado(this.authStore.obtenerContextoActual());
  }

  volver(): void { this.router.navigate(['/home']); }

  /** Actualiza el estado y la URL; reemplaza la entrada del historial para no saturarlo. */
  private aplicarEstados(estados: EstadoSolicitud[]): void {
    this.estados.set(estados);
    this.estadosDesconocidos.set([]);
    this.paginaSolicitada.set(1);
    this.sincronizarUrl();
  }

  /** Escribe el estado completo del listado en la URL (sin combinar con parámetros anteriores). */
  private sincronizarUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.parametrosListado(),
      replaceUrl: true
    });
  }
}
