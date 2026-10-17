import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonCard, IonCardContent, IonContent, IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { formatearFechaCalendario, formatearFechaHoraChile } from '../../core/utils/fechas';

@Component({
  selector: 'app-practica-detalle', standalone: true,
  imports: [CommonModule, IonButton, IonCard, IonCardContent, IonContent, IonSpinner],
  templateUrl: './practica-detalle.html', styleUrl: './practica-detalle.scss'
})
export class PracticaDetalle implements OnInit, OnDestroy {
  detalle: PracticaDetalleGestionResponse | null = null;
  cargando = false;
  error = '';
  permiteReintentar = false;
  private idPractica = '';
  private consulta?: Subscription;
  private parametros?: Subscription;
  readonly formatearFechaHora = formatearFechaHoraChile;
  readonly formatearFecha = formatearFechaCalendario;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly practicas: PracticaService
  ) {}

  ngOnInit(): void {
    this.parametros = this.route.paramMap.subscribe(parametros => {
      this.idPractica = parametros.get('id') ?? '';
      this.cargar();
    });
  }

  ngOnDestroy(): void {
    this.parametros?.unsubscribe();
    this.consulta?.unsubscribe();
  }

  cargar(): void {
    this.consulta?.unsubscribe();
    this.detalle = null;
    this.error = '';
    this.permiteReintentar = false;
    this.cargando = false;
    if (!/^[1-9][0-9]{0,18}$/.test(this.idPractica)
      || BigInt(this.idPractica) > 9223372036854775807n) {
      this.error = 'El identificador de práctica no es válido.';
      return;
    }
    this.cargando = true;
    this.consulta = this.practicas.obtenerDetalle(this.idPractica).subscribe({
      next: detalle => { this.detalle = detalle; this.cargando = false; },
      error: (error: HttpErrorResponse) => {
        this.cargando = false;
        if (error.status === 404) {
          this.error = 'La práctica no existe.';
        } else if (error.status === 401 || error.status === 403) {
          this.error = 'Acceso denegado. Revisa tu sesión y permisos.';
        } else if (error.status === 422) {
          this.error = 'El identificador de práctica no es válido.';
        } else {
          this.error = 'No fue posible cargar la práctica. Intenta nuevamente.';
          this.permiteReintentar = true;
        }
      }
    });
  }

  volver(): void { this.router.navigate(['/practicas']); }
}
