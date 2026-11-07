import { InformeFinal } from '../informe-final/informe-final';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonSpinner } from '@ionic/angular';
import { SesionService } from '../../core/session/sesion.service';
import { DocenteService, PracticaDocente } from './docente.service';

@Component({
  standalone: true, selector: 'app-docente-practicas',
  imports: [CommonModule, RouterLink, IonContent, IonButton, IonSpinner, InformeFinal],
  templateUrl: './docente-practicas.html', styleUrl: './docente-practicas.scss'
})
export class DocentePracticas implements OnInit {
  private readonly api = inject(DocenteService);
  private readonly route = inject(ActivatedRoute);
  private readonly sesion = inject(SesionService);
  practica: PracticaDocente | null = null;
  practicas: PracticaDocente[] = [];
  cargando = true;
  error = '';
  esDetalle = false;
  cerrarSesion(): void { this.sesion.cerrar(); }

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.esDetalle = id !== null;
    this.cargando = true;
    this.error = '';

    if (id !== null) {
      this.api.obtener(id).subscribe({
        next: (practica: PracticaDocente) => {
          this.practica = practica;
          this.cargando = false;
        },
        error: (error: HttpErrorResponse) => this.manejarError(error)
      });
      return;
    }

    this.api.listar().subscribe({
      next: (practicas: PracticaDocente[]) => {
        this.practicas = practicas;
        this.cargando = false;
      },
      error: (error: HttpErrorResponse) => this.manejarError(error)
    });
  }

  private manejarError(error: HttpErrorResponse): void {
    this.error = error.status === 404 ? 'La práctica no está asignada a esta cuenta.'
      : error.status === 403 ? 'Tu cuenta no tiene un rol DOCENTE activo.'
      : 'No fue posible cargar las prácticas. Intenta nuevamente.';
    this.cargando = false;
  }
}
