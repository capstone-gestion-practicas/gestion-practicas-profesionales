import { Component, ElementRef, HostListener, Injector, ViewChild, afterNextRender, input, output, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronDownOutline } from 'ionicons/icons';

/**
 * Menú de cuenta del estudiante (disclosure accesible).
 * El panel solo existe cuando está abierto; Escape y el clic fuera lo cierran,
 * y el foco vuelve al disparador salvo cuando el foco ya salió del componente.
 */
@Component({
  selector: 'app-student-account',
  standalone: true,
  imports: [IonIcon],
  templateUrl: './student-account.html',
  styleUrl: './student-account.scss'
})
export class StudentAccount {
  readonly nombre = input.required<string>();
  readonly inicial = input.required<string>();
  readonly cerrarSesion = output<void>();
  /** El espacio docente no tiene página de perfil: el menú lo oculta con false. */
  readonly mostrarPerfil = input(true);

  readonly menuAbierto = signal(false);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);

  @ViewChild('disparador') private disparador?: ElementRef<HTMLButtonElement>;
  @ViewChild('contenedor') private contenedor?: ElementRef<HTMLElement>;
  @ViewChild('primeraAccion') private primeraAccion?: ElementRef<HTMLButtonElement>;

  constructor() {
    addIcons({ chevronDownOutline });
  }

  alternarMenu(): void {
    if (this.menuAbierto()) {
      this.cerrarMenu(true);
    } else {
      this.menuAbierto.set(true);
      afterNextRender(() => this.primeraAccion?.nativeElement.focus(), { injector: this.injector });
    }
  }

  cerrarMenu(restaurarFoco: boolean): void {
    if (!this.menuAbierto()) return;
    this.menuAbierto.set(false);
    if (restaurarFoco) this.disparador?.nativeElement.focus();
  }

  /** Navega a Mi perfil y cierra el menú; el foco lo recibe el título de la página de destino. */
  abrirPerfil(): void {
    this.cerrarMenu(false);
    void this.router.navigate(['/estudiante/perfil']);
  }

  salirDesdeMenu(): void {
    this.cerrarMenu(false);
    this.cerrarSesion.emit();
  }

  salirDelFoco(evento: FocusEvent): void {
    const destino = evento.relatedTarget as Node | null;
    if (this.menuAbierto() && !this.contenedor?.nativeElement.contains(destino)) {
      this.cerrarMenu(false);
    }
  }

  @HostListener('document:keydown.escape')
  alPulsarEscape(): void {
    this.cerrarMenu(true);
  }

  @HostListener('document:click', ['$event'])
  alHacerClic(evento: Event): void {
    const destino = evento.target as Node | null;
    if (this.menuAbierto() && destino && !this.contenedor?.nativeElement.contains(destino)) {
      this.cerrarMenu(false);
    }
  }
}
