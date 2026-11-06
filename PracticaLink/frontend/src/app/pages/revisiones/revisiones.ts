import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/store/auth.store';
import { esEspacioGestorDedicado } from '../../core/navigation/espacio-gestor';
import {
  IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonContent, IonSpinner, IonGrid, IonRow, IonCol
} from '@ionic/angular';

import { SolicitudRevisionResumen } from '../../core/models/revision.models';
import { RevisionService } from '../../core/services/revision.service';

@Component({
  selector: 'app-revisiones',
  standalone: true,
  imports: [CommonModule, IonContent, IonCard, IonCardHeader, IonCardTitle,
    IonCardContent, IonButton, IonSpinner, IonGrid, IonRow, IonCol],
  templateUrl: './revisiones.html',
  styleUrl: './revisiones.scss'
})
export class Revisiones implements OnInit {
  private readonly authStore = inject(AuthStore);
  solicitudes: SolicitudRevisionResumen[] = [];
  cargando = true;
  error = '';

  constructor(
    private readonly revisionService: RevisionService,
    private readonly router: Router
  ) {}

  ngOnInit(): void { this.cargar(); }

  cargar(): void {
    this.cargando = true;
    this.revisionService.listar().subscribe({
      next: solicitudes => {
        this.solicitudes = solicitudes;
        this.cargando = false;
      },
      error: () => {
        this.error = 'No fue posible cargar las solicitudes.';
        this.cargando = false;
      }
    });
  }

  revisar(idPractica: number): void {
    this.router.navigate(['/revisiones', idPractica]);
  }

  mostrarVolver(): boolean {
    return !esEspacioGestorDedicado(this.authStore.obtenerContextoActual());
  }

  volver(): void { this.router.navigate(['/home']); }
}
