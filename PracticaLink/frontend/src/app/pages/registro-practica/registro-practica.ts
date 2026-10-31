import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonContent, IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import {
  EstadoIncidencia,
  RegistroPracticaLocal,
  RegistroPracticaService,
  TipoRegistroPractica
} from '../../core/services/registro-practica.service';

@Component({
  selector: 'app-registro-practica',
  standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonContent, IonSpinner],
  templateUrl: './registro-practica.html',
  styleUrl: './registro-practica.scss'
})
export class RegistroPractica implements OnInit, OnDestroy {
  detalle: PracticaDetalleGestionResponse | null = null;
  tipo: TipoRegistroPractica = 'seguimiento';
  idPractica = '';
  fecha = this.fechaLocalHoy();
  tipoContacto = '';
  observaciones = '';
  proximaFecha = '';
  estadoIncidencia: EstadoIncidencia = 'Pendiente';
  descripcionIncidencia = '';
  incidencias: RegistroPracticaLocal[] = [];
  cargando = true;
  guardando = false;
  error = '';
  mensaje = '';
  private consulta?: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly practicas: PracticaService,
    private readonly registros: RegistroPracticaService
  ) {}

  ngOnInit(): void {
    this.tipo = this.route.snapshot.data['tipoRegistro'] === 'incidencia'
      ? 'incidencia'
      : 'seguimiento';
    this.idPractica = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.idValido()) {
      this.error = 'El identificador de práctica no es válido.';
      this.cargando = false;
      return;
    }
    this.incidencias = this.registros.listar(this.idPractica)
      .filter(registro => registro.tipo === 'incidencia');
    this.consulta = this.practicas.obtenerDetalle(this.idPractica).subscribe({
      next: detalle => {
        this.detalle = detalle;
        this.cargando = false;
      },
      error: (error: HttpErrorResponse) => {
        this.cargando = false;
        this.error = error.status === 404
          ? 'La práctica no existe.'
          : error.status === 401 || error.status === 403
            ? 'Acceso denegado. Revisa tu sesión y permisos.'
            : 'No fue posible cargar la práctica. Intenta nuevamente.';
      }
    });
  }

  ngOnDestroy(): void {
    this.consulta?.unsubscribe();
  }

  get esIncidencia(): boolean {
    return this.tipo === 'incidencia';
  }

  cancelar(): void {
    this.router.navigate(['/practicas', this.idPractica]);
  }

  navegarA(ruta: string): void {
    this.router.navigate([ruta]);
  }

  guardar(): void {
    if (!this.detalle || this.guardando) return;
    const texto = this.esIncidencia ? this.descripcionIncidencia : this.observaciones;
    if (!this.fecha || !texto.trim() || (!this.esIncidencia && !this.tipoContacto)) {
      this.error = 'Completa los campos obligatorios antes de guardar.';
      return;
    }

    this.guardando = true;
    this.error = '';
    try {
      this.registros.guardar(this.esIncidencia
        ? {
            id_practica: this.idPractica,
            tipo: 'incidencia',
            fecha: this.fecha,
            estado: this.estadoIncidencia,
            descripcion: this.descripcionIncidencia.trim()
          }
        : {
            id_practica: this.idPractica,
            tipo: 'seguimiento',
            fecha: this.fecha,
            tipo_contacto: this.tipoContacto,
            observaciones: this.observaciones.trim(),
            proxima_fecha: this.proximaFecha || undefined
          });
      this.router.navigate(['/practicas', this.idPractica]);
    } catch (error) {
      this.error = error instanceof Error
        ? error.message
        : 'No se pudo guardar el registro.';
      this.guardando = false;
    }
  }

  private idValido(): boolean {
    return /^[1-9][0-9]{0,18}$/.test(this.idPractica)
      && BigInt(this.idPractica) <= 9223372036854775807n;
  }

  private fechaLocalHoy(): string {
    const hoy = new Date();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const dia = String(hoy.getDate()).padStart(2, '0');
    return `${hoy.getFullYear()}-${mes}-${dia}`;
  }
}