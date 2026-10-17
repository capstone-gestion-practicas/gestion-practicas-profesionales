import { CommonModule } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
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
  cerrar(): void {
    this.modalController.dismiss();
  }

  irARevisiones(): void {
    this.modalController.dismiss({ irARevisiones: true });
  }

  abrirSolicitud(idPractica: number): void {
    this.modalController.dismiss({ idPractica });
  }
}
