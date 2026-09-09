import { CommonModule } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  ModalController
} from '@ionic/angular';

import { SolicitudRevisionResumen } from '../../core/models/revision.models';

@Component({
  selector: 'app-solicitudes-pendientes-modal',
  standalone: true,
  imports: [CommonModule, IonContent, IonList, IonItem, IonLabel, IonNote, IonButton],
  templateUrl: './solicitudes-pendientes-modal.html',
  styleUrl: './solicitudes-pendientes-modal.scss'
})
export class SolicitudesPendientesModal {
  @Input() solicitudes: SolicitudRevisionResumen[] = [];

  private readonly modalController = inject(ModalController);
  private readonly router = inject(Router);

  cerrar(): void {
    this.modalController.dismiss();
  }

  irARevisiones(): void {
    this.modalController.dismiss();
    this.router.navigate(['/revisiones']);
  }
}
