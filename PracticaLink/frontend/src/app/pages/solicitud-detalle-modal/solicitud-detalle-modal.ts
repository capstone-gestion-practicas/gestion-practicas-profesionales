import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
  ModalController
} from '@ionic/angular';

import { SolicitudRevisionDetalle } from '../../core/models/revision.models';
import { RevisionService } from '../../core/services/revision.service';

@Component({
  selector: 'app-solicitud-detalle-modal',
  standalone: true,
  imports: [CommonModule, IonContent, IonList, IonItem, IonLabel, IonButton, IonSpinner],
  templateUrl: './solicitud-detalle-modal.html',
  styleUrl: './solicitud-detalle-modal.scss'
})
export class SolicitudDetalleModal implements OnInit {
  @Input({ required: true }) idPractica!: number;

  solicitud: SolicitudRevisionDetalle | null = null;
  cargando = true;
  error = '';

  private readonly modalController = inject(ModalController);
  private readonly revisionService = inject(RevisionService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    this.revisionService.obtener(this.idPractica).subscribe({
      next: solicitud => {
        this.solicitud = solicitud;
        this.cargando = false;
      },
      error: () => {
        this.error = 'No fue posible cargar los antecedentes de la solicitud.';
        this.cargando = false;
      }
    });
  }

  cerrar(): void {
    this.modalController.dismiss();
  }

  abrirRevision(): void {
    this.modalController.dismiss();
    this.router.navigate(['/revisiones', this.idPractica]);
  }
}
