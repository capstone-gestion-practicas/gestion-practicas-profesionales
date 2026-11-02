import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonButton, IonCard, IonCardContent, IonContent, IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { formatearFechaHoraChile } from '../../core/utils/fechas';

import { PracticaIncidenciasPendientesItem, PracticaResumen } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';

type EstadoResumen = 'inactivo' | 'cargando' | 'listo' | 'error';

@Component({
  selector: 'app-practicas-listado',
  standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonCard, IonCardContent, IonContent, IonSpinner],
  templateUrl: './practicas-listado.html',
  styleUrl: './practicas-listado.scss'
})
export class PracticasListado implements OnInit, OnDestroy {
  rutBusqueda = '';
  private rutActivo: string | undefined;
  private consulta?: Subscription;
  items: PracticaResumen[] = [];
  readonly limit = 50;
  offset = 0;
  hayMas = false;
  cargando = false;
  error = '';
  errorConsulta = false;

  get filtroAplicado(): boolean { return this.rutActivo !== undefined; }

  // HU017: resumen independiente del listado. Se carga completo una vez (páginas de 100)
  // y se cruza por id_practica; no se emparejan páginas porque los criterios difieren.
  readonly limitResumen = 100;
  resumenEstado: EstadoResumen = 'inactivo';
  resumenError = '';
  private resumen = new Map<number, PracticaIncidenciasPendientesItem>();
  private suscripcionResumen?: Subscription;

  get puedeVerResumen(): boolean {
    return (this.auth.contexto()?.roles ?? []).some(rol => rol === 'GESTOR' || rol === 'ADMINISTRADOR');
  }

  reintentar(): void {
    if (this.errorConsulta) this.cargar();
  }

  reintentarResumen(): void {
    if (this.resumenEstado === 'error') this.cargarResumen();
  }

  constructor(private readonly practicas: PracticaService, private readonly router: Router,
              private readonly auth: AuthStore) {}

  ngOnInit(): void {
    this.cargar(0);
    this.cargarResumen();
  }

  ngOnDestroy(): void {
    this.consulta?.unsubscribe();
    this.suscripcionResumen?.unsubscribe();
  }

  cargarResumen(): void {
    this.suscripcionResumen?.unsubscribe();
    if (!this.puedeVerResumen) { this.resumenEstado = 'inactivo'; return; }
    this.resumen = new Map();
    this.resumenError = '';
    this.resumenEstado = 'cargando';
    this.pedirPaginaResumen(0, []);
  }

  pendientesDe(idPractica: number): number { return this.resumen.get(idPractica)?.pendientes ?? 0; }
  enGestionDe(idPractica: number): number { return this.resumen.get(idPractica)?.en_atencion ?? 0; }
  fechaPendienteDe(idPractica: number): string | null {
    return this.resumen.get(idPractica)?.fecha_pendiente_antigua ?? null;
  }

  // Un id fuera del rango seguro de JavaScript no puede cruzarse con precisión.
  identificadorSeguro(idPractica: number): boolean {
    return Number.isSafeInteger(idPractica) && idPractica > 0;
  }

  private pedirPaginaResumen(offset: number, acumulado: PracticaIncidenciasPendientesItem[]): void {
    this.suscripcionResumen = this.practicas.obtenerResumenIncidenciasPendientes(this.limitResumen, offset).subscribe({
      next: pagina => {
        if (!this.paginaResumenValida(pagina, offset)) { this.fallarResumen(0); return; }
        const todos = [...acumulado, ...pagina.items];
        if (pagina.hay_mas) { this.pedirPaginaResumen(offset + this.limitResumen, todos); return; }
        const mapa = new Map(todos.map(item => [item.id_practica, item] as const));
        if (mapa.size !== todos.length) { this.fallarResumen(0); return; }
        this.resumen = mapa;
        this.resumenEstado = 'listo';
      },
      error: (error: HttpErrorResponse) => this.fallarResumen(error.status)
    });
  }

  private paginaResumenValida(pagina: { items: PracticaIncidenciasPendientesItem[]; limit: number;
      offset: number; hay_mas: boolean }, offset: number): boolean {
    if (!pagina || !Array.isArray(pagina.items) || pagina.limit !== this.limitResumen
        || pagina.offset !== offset || pagina.items.length > this.limitResumen
        || (pagina.hay_mas && pagina.items.length !== this.limitResumen)) {
      return false;
    }
    return pagina.items.every(item =>
      Number.isSafeInteger(item.id_practica) && item.id_practica > 0
      && Number.isSafeInteger(item.pendientes) && item.pendientes >= 1
      && Number.isSafeInteger(item.en_atencion) && item.en_atencion >= 0
      && Number.isFinite(Date.parse(item.fecha_pendiente_antigua)));
  }

  private fallarResumen(status: number): void {
    this.resumenEstado = 'error';
    this.resumen = new Map();
    this.resumenError = status === 401 || status === 403
      ? 'No tienes autorización para consultar incidencias pendientes.'
      : 'No fue posible cargar las incidencias pendientes. Intenta nuevamente.';
  }

  buscar(): void {
    this.consulta?.unsubscribe();
    this.items = [];
    this.hayMas = false;
    this.cargando = false;
    this.errorConsulta = false;
    const rut = this.rutBusqueda.trim();
    if (rut && !/^[0-9]{7,8}-[0-9Kk]$/.test(rut)) {
      this.offset = 0;
      this.rutActivo = undefined;
      this.error = 'Ingresa el RUT sin puntos, con guion y dígito verificador.';
      return;
    }
    this.rutActivo = rut || undefined;
    this.cargar(0);
  }

  limpiar(): void {
    this.rutBusqueda = '';
    this.rutActivo = undefined;
    this.cargar(0);
  }

  anterior(): void {
    if (!this.cargando && this.offset > 0) this.cargar(Math.max(0, this.offset - this.limit));
  }

  siguiente(): void {
    if (!this.cargando && this.hayMas) this.cargar(this.offset + this.limit);
  }

  cargar(offset = this.offset): void {
    this.consulta?.unsubscribe();
    this.offset = offset;
    this.items = [];
    this.hayMas = false;
    this.error = '';
    this.errorConsulta = false;
    this.cargando = true;
    this.consulta = this.practicas.listar(this.limit, offset, this.rutActivo).subscribe({
      next: respuesta => {
        this.items = respuesta.items;
        this.hayMas = respuesta.hay_mas;
        this.cargando = false;
      },
      error: (error: HttpErrorResponse) => {
        this.cargando = false;
        this.errorConsulta = true;
        this.error = error.status === 422
          ? 'El RUT no es válido. Revisa el formato y el dígito verificador.'
          : error.status === 401 || error.status === 403
            ? 'No tienes autorización para consultar las prácticas. Revisa tu sesión.'
            : 'No fue posible cargar las prácticas. Intenta nuevamente.';
      }
    });
  }

  formatearFecha(fecha: string | null): string {
    return formatearFechaHoraChile(fecha);
  }

  verAntecedentes(idPractica: number): void {
    this.router.navigate(['/practicas', idPractica]);
  }

  volver(): void { this.router.navigate(['/home']); }
}
