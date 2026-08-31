import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonContent, IonModal, IonSpinner, IonTextarea
} from '@ionic/angular';

import {
  DecisionRevision,
  SolicitudRevisionDetalle
} from '../../core/models/revision.models';
import { RevisionService } from '../../core/services/revision.service';

@Component({
  selector: 'app-revision-detalle', standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonCard, IonCardHeader,
    IonCardTitle, IonCardContent, IonButton, IonModal, IonSpinner, IonTextarea],
  templateUrl: './revision-detalle.html', styleUrl: './revision-detalle.scss'
})
export class RevisionDetalle implements OnInit {
  solicitud: SolicitudRevisionDetalle | null = null;
  cargando = true;
  error = '';
  modalAbierto = false;
  guardando = false;
  decision: DecisionRevision = 'APROBADA';
  observacion = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly revisionService: RevisionService
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.revisionService.obtener(id).subscribe({
      next: solicitud => { this.solicitud = solicitud; this.cargando = false; },
      error: () => { this.error = 'No fue posible cargar la solicitud.'; this.cargando = false; }
    });
  }

  abrirDecision(decision: DecisionRevision): void {
    this.decision = decision;
    this.observacion = '';
    this.error = '';
    this.modalAbierto = true;
  }

  cerrarModal(): void { if (!this.guardando) this.modalAbierto = false; }

  confirmar(): void {
    if (!this.solicitud) return;
    if (this.decision !== 'APROBADA' && !this.observacion.trim()) {
      this.error = 'Debes ingresar una observación.';
      return;
    }
    this.guardando = true;
    this.revisionService.resolver(
      this.solicitud.id_practica,
      this.decision,
      this.observacion.trim() || null
    ).subscribe({
      next: () => { this.guardando = false; this.router.navigate(['/revisiones']); },
      error: (error: HttpErrorResponse) => {
        this.guardando = false;
        this.error = error.error?.detail ?? 'No fue posible guardar la decisión.';
      }
    });
  }

  volver(): void { this.router.navigate(['/revisiones']); }
}
