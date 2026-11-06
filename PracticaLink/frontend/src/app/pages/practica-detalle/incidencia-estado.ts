import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { IonButton, IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { EstadoIncidencia, IncidenciaEstadoEvento, IncidenciaHistorialItem } from '../../core/models/incidencia.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { SesionService } from '../../core/session/sesion.service';
import { formatearFechaHoraChile } from '../../core/utils/fechas';

@Component({
  selector: 'app-incidencia-estado', standalone: true,
  imports: [FormsModule, IonButton, IonSpinner],
  templateUrl: './incidencia-estado.html', styleUrl: './incidencia-estado.scss'
})
export class IncidenciaEstado implements OnChanges, OnDestroy {
  @Input({ required: true }) practica = '';
  @Input({ required: true }) incidencia!: IncidenciaHistorialItem;
  @Output() recargar = new EventEmitter<string>();
  @Output() ocupado = new EventEmitter<boolean>();
  eventos: IncidenciaEstadoEvento[] = [];
  readonly limit = 50;
  offset = 0;
  hayMas = false;
  cargando = false;
  consultado = false;
  error = '';
  errorCambio = '';
  guardando = false;
  bloqueado = false;
  trazabilidadValida = false;
  destino: EstadoIncidencia | '' = '';
  comentario = '';
  private lectura?: Subscription;
  private escritura?: Subscription;

  constructor(private readonly servicio: PracticaService, private readonly auth: AuthStore,
              private readonly router: Router, private readonly sesion: SesionService) {}

  get autorizado(): boolean {
    return (this.auth.contexto()?.roles ?? []).some(r => r === 'GESTOR' || r === 'ADMINISTRADOR');
  }

  get identificadoresSeguros(): boolean {
    return Number.isSafeInteger(this.incidencia.id_incidencia) && this.incidencia.id_incidencia > 0
      && Number.isSafeInteger(this.incidencia.id_practica)
      && String(this.incidencia.id_practica) === this.practica;
  }

  get transiciones(): EstadoIncidencia[] {
    if (!this.autorizado || !this.identificadoresSeguros || !this.trazabilidadValida || this.bloqueado) return [];
    return this.incidencia.estado === 'PENDIENTE' ? ['EN_ATENCION', 'RESUELTA']
      : this.incidencia.estado === 'EN_ATENCION' ? ['RESUELTA'] : [];
  }

  ngOnChanges(): void {
    this.lectura?.unsubscribe();
    this.escritura?.unsubscribe();
    this.eventos = []; this.offset = 0; this.hayMas = false;
    this.cargando = false; this.consultado = false; this.error = ''; this.errorCambio = '';
    this.guardando = false; this.bloqueado = false; this.trazabilidadValida = false;
    this.destino = ''; this.comentario = '';
    this.cargar(0);
  }

  ngOnDestroy(): void {
    this.lectura?.unsubscribe();
    this.escritura?.unsubscribe();
  }

  fecha(value: string): string {
    return Number.isFinite(Date.parse(value)) ? formatearFechaHoraChile(value) : value;
  }

  cargar(offset = this.offset): void {
    if (this.cargando || this.guardando) return;
    if (!this.autorizado) { this.error = 'Acceso denegado al historial de la incidencia.'; return; }
    if (!this.identificadoresSeguros) {
      this.error = 'El identificador no puede representarse con precisión. No se enviará una solicitud.';
      return;
    }
    this.lectura?.unsubscribe();
    this.offset = offset; this.eventos = []; this.hayMas = false;
    this.consultado = false; this.error = ''; this.cargando = true;
    this.lectura = this.servicio.obtenerHistorialIncidencia(
      this.practica, String(this.incidencia.id_incidencia), this.limit, offset
    ).subscribe({
      next: pagina => {
        this.cargando = false;
        if (pagina.id_practica !== this.incidencia.id_practica
            || pagina.id_incidencia !== this.incidencia.id_incidencia
            || pagina.limit !== this.limit || pagina.offset !== offset) {
          this.error = 'No se pudo validar el historial recibido.';
          return;
        }
        this.eventos = pagina.items; this.hayMas = pagina.hay_mas; this.consultado = true;
        if (offset === 0) this.trazabilidadValida = !pagina.hay_mas && this.cadenaValida(pagina.items);
      },
      error: (error: HttpErrorResponse) => {
        this.cargando = false;
        this.error = this.mensajeError(error.status);
        this.autenticacion(error.status);
      }
    });
  }

  private cadenaValida(items: IncidenciaEstadoEvento[]): boolean {
    const i = this.incidencia;
    if (i.sin_tipo_registrado || i.tipo === null || !i.descripcion.trim()
        || Array.from(i.descripcion).length > 2000 || !Number.isFinite(Date.parse(i.fecha))
        || i.fecha_resolucion !== null || i.resolucion !== null || items.length === 0) return false;
    const cadena = [...items].reverse();
    const inicial = cadena[0];
    if (inicial.estado_anterior !== null || inicial.estado_nuevo !== 'PENDIENTE'
        || inicial.id_usuario !== i.id_usuario || Date.parse(inicial.fecha) !== Date.parse(i.fecha)) return false;
    for (let n = 0; n < cadena.length; n++) {
      const e = cadena[n];
      if (!Number.isSafeInteger(e.id_historial) || !Number.isFinite(Date.parse(e.fecha))) return false;
      if (n > 0) {
        const previo = cadena[n - 1];
        if (e.id_historial <= previo.id_historial || e.estado_anterior !== previo.estado_nuevo
            || Date.parse(e.fecha) < Date.parse(previo.fecha)
            || !((e.estado_anterior === 'PENDIENTE' && ['EN_ATENCION', 'RESUELTA'].includes(e.estado_nuevo))
              || (e.estado_anterior === 'EN_ATENCION' && e.estado_nuevo === 'RESUELTA'))) return false;
      }
    }
    return cadena[cadena.length - 1].estado_nuevo === i.estado;
  }

  guardar(): void {
    if (this.guardando || this.cargando || !this.destino || !this.transiciones.includes(this.destino)) return;
    const limpio = this.comentario.replace(/^ +| +$/g, '');
    const comentario = limpio.trim() ? limpio : null;
    if ((this.destino === 'RESUELTA' && comentario === null)
        || (comentario !== null && Array.from(comentario).length > 2000)) {
      this.errorCambio = 'Resolver requiere un comentario con contenido. Máximo 2.000 caracteres.';
      return;
    }
    const esperado = this.incidencia.estado as EstadoIncidencia;
    const nuevo = this.destino;
    this.errorCambio = ''; this.guardando = true; this.ocupado.emit(true);
    this.escritura = this.servicio.cambiarEstadoIncidencia(this.practica,
      String(this.incidencia.id_incidencia), { estado_esperado: esperado, estado_nuevo: nuevo, comentario }
    ).subscribe({
      next: respuesta => {
        const r = respuesta.body;
        const valida = respuesta.status === 200 && r
          && r.id_practica === this.incidencia.id_practica && r.id_incidencia === this.incidencia.id_incidencia
          && r.estado_anterior === esperado && r.estado_nuevo === nuevo && r.comentario === comentario
          && r.id_usuario === this.auth.contexto()?.usuario.id_usuario
          && Number.isSafeInteger(r.id_historial) && Number.isFinite(Date.parse(r.fecha));
        this.actualizar(valida ? 'Cambio de estado confirmado. Se está actualizando el listado.'
          : 'No se pudo validar la confirmación. Se consultará el estado real; no reenvíe automáticamente.');
      },
      error: (error: HttpErrorResponse) => {
        this.guardando = false; this.ocupado.emit(false);
        if (error.status === 409) {
          this.actualizar('No se confirmó el cambio: otro gestor pudo modificar la incidencia o su historial no permite la transición. Se consultará el estado actual.');
        } else if (error.status === 0 || error.status >= 500 || error.status < 400) {
          this.actualizar('No se pudo confirmar el resultado. Se consultará el estado real; no reenvíe automáticamente.');
        } else {
          this.errorCambio = this.mensajeError(error.status);
          if (error.status !== 422) this.bloqueado = true;
          this.autenticacion(error.status);
        }
      }
    });
  }

  private actualizar(mensaje: string): void {
    this.guardando = false; this.bloqueado = true; this.ocupado.emit(false);
    this.recargar.emit(mensaje);
  }

  private autenticacion(status: number): void {
    if (status === 401) {
      this.sesion.cerrar();
    }
  }

  private mensajeError(status: number): string {
    return ({ 401: 'Tu sesión no es válida. Inicia sesión nuevamente.',
      403: 'No tienes permisos para esta operación.', 404: 'La incidencia no está disponible para esta práctica.',
      422: 'Los parámetros o el comentario no son válidos.',
      503: 'El servicio está temporalmente no disponible.', 500: 'El servidor no pudo completar la consulta.'
    } as Record<number, string>)[status] ?? 'No fue posible conectar con el servidor.';
  }

  anterior(): void { if (this.offset > 0) this.cargar(Math.max(0, this.offset - this.limit)); }
  siguiente(): void { if (this.hayMas) this.cargar(this.offset + this.limit); }
}
