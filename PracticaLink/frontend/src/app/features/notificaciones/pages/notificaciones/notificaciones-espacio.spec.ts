import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { Observable, Subject, of, throwError } from 'rxjs';

import { ESPACIO_PAGINA, EspacioPagina } from '../../../../core/navigation/espacio-pagina.token';
import { Router } from '@angular/router';
import { Notificacion, NotificacionesResumen } from '../../models/notificacion.models';
import { NotificacionService } from '../../services/notificacion.service';
import { Notificaciones } from './notificaciones';
import { codigosInternosVisibles } from '../../../../shared/testing/codigos-internos';

describe('Notificaciones: presentación por espacio', () => {
  let fixture: ComponentFixture<Notificaciones>;
  let noLeidas: ReturnType<typeof signal<number>>;
  let listar: jasmine.Spy<() => Observable<NotificacionesResumen>>;
  let marcarTodasLeidas: jasmine.Spy;

  const notificacion: Notificacion = {
    id_notificacion: 1, id_practica: 15, tipo: 'CAMBIO_ESTADO', titulo: 'Cambio de estado',
    mensaje: 'Tu práctica fue revisada', fecha_creacion: '2026-01-01T12:00:00Z', fecha_leida: null
  } as unknown as Notificacion;

  function configurar(espacio: EspacioPagina | null, respuesta: Observable<NotificacionesResumen> = of({ notificaciones: [], no_leidas: 0 } as NotificacionesResumen)): void {
    TestBed.resetTestingModule();
    noLeidas = signal(0);
    listar = jasmine.createSpy('listar').and.returnValue(respuesta);
    marcarTodasLeidas = jasmine.createSpy('marcarTodasLeidas').and.returnValue(of({ actualizadas: 0 }));
    const providers: unknown[] = [
      provideIonicAngular(),
      provideRouter([]),
      {
        provide: NotificacionService,
        useValue: {
          noLeidas,
          estadoRegistroPush: signal('inactivo'),
          listar,
          marcarTodasLeidas,
          marcarLeida: jasmine.createSpy('marcarLeida').and.returnValue(of(undefined))
        }
      }
    ];
    if (espacio) providers.push({ provide: ESPACIO_PAGINA, useValue: espacio });
    TestBed.configureTestingModule({ imports: [Notificaciones], providers: providers as never[] });
    fixture = TestBed.createComponent(Notificaciones);
  }

  function texto(): string {
    return fixture.nativeElement.textContent as string;
  }

  function botonPorTexto(etiqueta: string): HTMLElement | undefined {
    return Array.from(fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(boton => boton.textContent?.trim().includes(etiqueta));
  }

  async function renderizar(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  describe('espacio V3 del estudiante', () => {
    beforeEach(() => configurar('estudiante'));

    it('no muestra el botón de push', async () => {
      await renderizar();
      expect(botonPorTexto('Activar push')).toBeUndefined();
    });

    it('no muestra «Volver al inicio»', async () => {
      await renderizar();
      expect(botonPorTexto('Volver al inicio')).toBeUndefined();
    });

    it('no muestra la etiqueta EP08 y conserva el título', async () => {
      await renderizar();
      expect(texto()).not.toContain('EP08');
      expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe('Notificaciones');
    });

    it('aplica la clase de presentación estudiantil', async () => {
      await renderizar();
      expect(fixture.nativeElement.querySelector('ion-content')?.classList)
        .toContain('notifications-content--estudiante');
    });

    it('muestra el estado vacío', async () => {
      await renderizar();
      expect(texto()).toContain('No tienes notificaciones todavía.');
    });

    it('muestra el estado de carga mientras espera la respuesta', async () => {
      configurar('estudiante', new Subject<NotificacionesResumen>().asObservable());
      await renderizar();
      expect(fixture.nativeElement.querySelector('ion-spinner')).not.toBeNull();
    });

    it('muestra el error y reintenta la consulta', async () => {
      configurar('estudiante', throwError(() => new Error('red')));
      await renderizar();
      expect(texto()).toContain('No fue posible cargar las notificaciones.');
      expect(listar).toHaveBeenCalledTimes(1);
      botonPorTexto('Reintentar')?.click();
      await renderizar();
      expect(listar).toHaveBeenCalledTimes(2);
    });

    it('muestra el contador de no leídas y «Marcar todas» deshabilitado sin pendientes', async () => {
      await renderizar();
      expect((botonPorTexto('Marcar todas') as unknown as { disabled: boolean }).disabled).toBeTrue();
    });

    it('«Marcar todas» llama al servicio cuando hay no leídas', async () => {
      configurar('estudiante', of({ notificaciones: [notificacion], no_leidas: 1 } as NotificacionesResumen));
      await renderizar();
      noLeidas.set(1);
      fixture.detectChanges();
      const boton = botonPorTexto('Marcar todas');
      expect(boton?.hasAttribute('disabled')).toBeFalse();
      boton?.click();
      expect(marcarTodasLeidas).toHaveBeenCalled();
    });

    it('filtra No leídas con contadores reales y oculta las ya leídas', async () => {
      const leida = { ...notificacion, id_notificacion: 2, titulo: 'Ya leída', fecha_leida: '2026-01-02T12:00:00Z' } as Notificacion;
      configurar('estudiante', of({ notificaciones: [notificacion, leida], no_leidas: 1 } as NotificacionesResumen));
      await renderizar();
      expect(texto()).toContain('Todas (2)');
      expect(texto()).toContain('No leídas (1)');
      expect(texto()).toContain('Ya leída');

      const noLeidas = Array.from(fixture.nativeElement.querySelectorAll('.filtro') as NodeListOf<HTMLButtonElement>)
        .find(boton => boton.textContent?.includes('No leídas'));
      noLeidas?.click();
      fixture.detectChanges();
      expect(texto()).not.toContain('Ya leída');
      expect(texto()).toContain('Cambio de estado');
      expect(noLeidas?.getAttribute('aria-pressed')).toBe('true');
    });

    it('lista las notificaciones con su título', async () => {
      configurar('estudiante', of({ notificaciones: [notificacion], no_leidas: 1 } as NotificacionesResumen));
      await renderizar();
      expect(texto()).toContain('Cambio de estado');
      expect(texto()).toContain('Nueva');
    });
  });

  describe('ruta original /notificaciones (gestor y administrador)', () => {
    beforeEach(() => configurar(null));

    it('conserva el botón de push, «Volver al inicio» y la etiqueta de módulo', async () => {
      await renderizar();
      expect(botonPorTexto('Activar push')).toBeDefined();
      expect(botonPorTexto('Volver al inicio')).toBeDefined();
      expect(texto()).toContain('CENTRO DE NOTIFICACIONES');
    });

    it('no aplica la clase de presentación estudiantil', async () => {
      await renderizar();
      expect(fixture.nativeElement.querySelector('ion-content')?.classList)
        .not.toContain('notifications-content--estudiante');
    });
  });

  describe('códigos internos en textos visibles', () => {
    it('gestor y administrador: muestra CENTRO DE NOTIFICACIONES y ningún código EP/HU', async () => {
      configurar(null);
      await renderizar();
      expect(fixture.nativeElement.querySelector('.module-label')?.textContent?.trim()).toBe('CENTRO DE NOTIFICACIONES');
      expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe('Notificaciones');
      expect(codigosInternosVisibles(fixture.nativeElement)).toEqual([]);
    });

    it('estudiante: no muestra etiqueta de módulo ni códigos EP/HU', async () => {
      configurar('estudiante');
      await renderizar();
      expect(fixture.nativeElement.querySelector('.module-label')).toBeNull();
      expect(texto()).not.toContain('CENTRO DE NOTIFICACIONES');
      expect(codigosInternosVisibles(fixture.nativeElement)).toEqual([]);
    });
  });

  describe('espacio del docente', () => {
    beforeEach(() => configurar('docente', of({ notificaciones: [notificacion], no_leidas: 1 } as NotificacionesResumen)));

    it('usa la presentación V3 con filtros y no muestra «Volver al inicio» del gestor', async () => {
      await renderizar();
      expect(fixture.nativeElement.querySelector('.notifications-content--estudiante')).not.toBeNull();
      expect(botonPorTexto('Volver al inicio')).toBeUndefined();
    });

    it('abre la práctica en el detalle docente al pulsar una notificación con id_practica', async () => {
      await renderizar();
      const router = TestBed.inject(Router);
      spyOn(router, 'navigate').and.resolveTo(true);
      fixture.componentInstance.abrir(notificacion);
      expect(router.navigate).toHaveBeenCalledWith(['/docente/practicas', 15]);
    });

    it('«Volver» lleva al listado de prácticas del docente', async () => {
      await renderizar();
      const router = TestBed.inject(Router);
      spyOn(router, 'navigate').and.resolveTo(true);
      fixture.componentInstance.volver();
      expect(router.navigate).toHaveBeenCalledWith(['/docente/practicas']);
    });
  });
});
