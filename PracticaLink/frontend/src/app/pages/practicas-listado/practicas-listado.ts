import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonButton, IonCard, IonCardContent, IonContent, IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { PracticaResumen } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';

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

  reintentar(): void {
    if (this.errorConsulta) this.cargar();
  }

  constructor(private readonly practicas: PracticaService, private readonly router: Router) {}

  ngOnInit(): void { this.cargar(0); }
  ngOnDestroy(): void { this.consulta?.unsubscribe(); }

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
    if (fecha === null) return 'Fecha no disponible';
    const partes = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(fecha));
    const valor = (tipo: Intl.DateTimeFormatPartTypes): string =>
      partes.find(parte => parte.type === tipo)?.value ?? '';
    return `${valor('day')}/${valor('month')}/${valor('year')}, ${valor('hour')}:${valor('minute')}`;
  }

  volver(): void { this.router.navigate(['/home']); }
}
