import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { Observable, of } from 'rxjs';

import { ContextoUsuarioResponse } from '../../../../core/models/auth.models';
import { AuthStore } from '../../../../core/store/auth.store';
import { codigosInternosVisibles } from '../../../../shared/testing/codigos-internos';
import { Notificacion, NotificacionesResumen } from '../../models/notificacion.models';
import { NotificacionService } from '../../services/notificacion.service';
import { CLAVE_AVISO_PUSH_OCULTO, Notificaciones } from './notificaciones';

describe('Notificaciones: presentación del GESTOR', () => {
  let fixture: ComponentFixture<Notificaciones>;
  let noLeidas: ReturnType<typeof signal<number>>;
  let marcarLeida: jasmine.Spy;
  let marcarTodasLeidas: jasmine.Spy;
  let permisoOriginal: PropertyDescriptor | undefined;

  const hoy = new Date().toISOString();
  const hace3Dias = new Date(Date.now() - 3 * 86_400_000).toISOString();

  const nueva = (id: number, tipo: string, leida: boolean, fecha = hoy, idPractica: number | null = 7): Notificacion => ({
    id_notificacion: id, id_practica: idPractica, tipo, titulo: `Titulo ${id}`, mensaje: `Mensaje ${id}`,
    fecha_creacion: fecha, fecha_leida: leida ? hoy : null
  });

  const contexto = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Demo', correo: 'gestor@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  function fijarPermiso(valor: NotificationPermission): void {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => valor });
  }

  function configurar(lista: Notificacion[], roles: string[] = ['GESTOR']): void {
    TestBed.resetTestingModule();
    noLeidas = signal(lista.filter(item => !item.fecha_leida).length);
    const respuesta: NotificacionesResumen = { notificaciones: lista, no_leidas: noLeidas() };
    marcarLeida = jasmine.createSpy('marcarLeida').and.returnValue(of(undefined));
    marcarTodasLeidas = jasmine.createSpy('marcarTodasLeidas').and.returnValue(of({ actualizadas: 0 }));
    TestBed.configureTestingModule({
      imports: [Notificaciones],
      providers: [
        provideIonicAngular(),
        provideRouter([]),
        {
          provide: NotificacionService,
          useValue: {
            noLeidas,
            estadoRegistroPush: signal('inactivo'),
            listar: (): Observable<NotificacionesResumen> => of(respuesta),
            marcarLeida,
            marcarTodasLeidas
          }
        }
      ]
    });
    TestBed.inject(AuthStore).setContexto(contexto(roles));
    fixture = TestBed.createComponent(Notificaciones);
  }

  async function renderizar(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const texto = (): string => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
  const filas = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('.fila') as NodeListOf<HTMLElement>);
  const chip = (etiqueta: string): HTMLElement | undefined =>
    Array.from(fixture.nativeElement.querySelectorAll('.chip') as NodeListOf<HTMLElement>)
      .find(item => item.textContent?.replace(/\s+/g, ' ').trim().startsWith(etiqueta));

  beforeEach(() => {
    permisoOriginal = Object.getOwnPropertyDescriptor(Notification, 'permission');
    fijarPermiso('granted');
    localStorage.removeItem(CLAVE_AVISO_PUSH_OCULTO);
  });

  afterEach(() => {
    if (permisoOriginal) Object.defineProperty(Notification, 'permission', permisoOriginal);
    localStorage.removeItem(CLAVE_AVISO_PUSH_OCULTO);
    fixture?.destroy();
  });

  describe('encabezado', () => {
    it('muestra el eyebrow, el título y el subtítulo con el número de no leídas', async () => {
      configurar([nueva(1, 'NUEVA_PRACTICA', false), nueva(2, 'NUEVA_PRACTICA', true)]);
      await renderizar();
      expect(fixture.nativeElement.querySelector('.notif-eyebrow')?.textContent?.trim()).toBe('CENTRO DE NOTIFICACIONES');
      expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe('Notificaciones');
      expect(texto()).toContain('Tienes 1 sin leer.');
    });

    it('sin no leídas dice «Estás al día» y oculta «Marcar todas como leídas»', async () => {
      configurar([nueva(1, 'NUEVA_PRACTICA', true)]);
      await renderizar();
      expect(texto()).toContain('Estás al día.');
      expect(texto()).not.toContain('Marcar todas como leídas');
    });

    it('con no leídas muestra «Marcar todas como leídas» como botón secundario', async () => {
      configurar([nueva(1, 'NUEVA_PRACTICA', false)]);
      await renderizar();
      const boton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
        .find(item => item.textContent?.trim() === 'Marcar todas como leídas');
      expect(boton?.classList.contains('btn-secundario')).toBeTrue();
    });

    it('no muestra el botón «Activar push» del encabezado', async () => {
      configurar([nueva(1, 'NUEVA_PRACTICA', false)]);
      await renderizar();
      expect(texto()).not.toContain('Activar push en este dispositivo');
    });
  });

  describe('aviso de push', () => {
    it('con permiso «default» muestra el aviso con «Ahora no» y «Activar»', async () => {
      fijarPermiso('default');
      configurar([nueva(1, 'NUEVA_PRACTICA', false)]);
      await renderizar();
      expect(texto()).toContain('Recibe avisos en este dispositivo');
      expect(texto()).toContain('Ahora no');
      expect(texto()).toContain('Activar');
    });

    it('«Ahora no» oculta el aviso y guarda la decisión en localStorage', async () => {
      fijarPermiso('default');
      configurar([nueva(1, 'NUEVA_PRACTICA', false)]);
      await renderizar();
      (Array.from(fixture.nativeElement.querySelectorAll('.btn-texto')) as HTMLButtonElement[])[0].click();
      fixture.detectChanges();
      expect(localStorage.getItem(CLAVE_AVISO_PUSH_OCULTO)).toBe('1');
      expect(texto()).not.toContain('Recibe avisos en este dispositivo');
    });

    it('con permiso concedido muestra una línea de confirmación', async () => {
      fijarPermiso('granted');
      configurar([nueva(1, 'NUEVA_PRACTICA', false)]);
      await renderizar();
      expect(texto()).toContain('Notificaciones activadas en este dispositivo');
      expect(texto()).not.toContain('Recibe avisos');
    });

    it('con permiso denegado no muestra nada', async () => {
      fijarPermiso('denied');
      configurar([nueva(1, 'NUEVA_PRACTICA', false)]);
      await renderizar();
      expect(texto()).not.toContain('Recibe avisos');
      expect(texto()).not.toContain('activadas en este dispositivo');
    });
  });

  describe('filtros y lista', () => {
    beforeEach(() => configurar([
      nueva(1, 'NUEVA_PRACTICA', false),
      nueva(2, 'RESPUESTA_OBSERVACION', true),
      nueva(3, 'CAMBIO_ESTADO', false, hace3Dias)
    ]));

    it('los chips muestran conteos reales por estado y sección', async () => {
      await renderizar();
      expect(chip('Todas')?.textContent).toContain('(3)');
      expect(chip('No leídas')?.textContent).toContain('(2)');
      expect(chip('Solicitudes')?.textContent).toContain('(2)');
      expect(chip('Seguimientos')?.textContent).toContain('(0)');
      expect(chip('Incidencias')?.textContent).toContain('(0)');
    });

    it('elegir Solicitudes muestra solo esa sección', async () => {
      await renderizar();
      chip('Solicitudes')?.click();
      fixture.detectChanges();
      expect(filas().length).toBe(2);
      expect(chip('Solicitudes')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('agrupa en Hoy y Anteriores sin grupos vacíos', async () => {
      await renderizar();
      const titulos = Array.from(fixture.nativeElement.querySelectorAll('.grupo__titulo') as NodeListOf<HTMLElement>)
        .map(item => item.textContent?.trim());
      expect(titulos).toEqual(['Hoy', 'Esta semana']);
    });

    it('la no leída lleva el punto, la etiqueta de sección y la fecha relativa con fecha exacta en title', async () => {
      await renderizar();
      const primera = filas()[0];
      expect(primera.classList.contains('fila--no-leida')).toBeTrue();
      expect(primera.querySelector('.punto')).not.toBeNull();
      expect(primera.querySelector('.etiqueta-seccion')?.textContent?.trim()).toBe('Solicitudes');
      expect(primera.querySelector('time')?.getAttribute('title')).toBeTruthy();
    });

    it('el botón ✓ solo aparece en las no leídas, con nombre accesible', async () => {
      await renderizar();
      const checks = fixture.nativeElement.querySelectorAll('.btn-check') as NodeListOf<HTMLElement>;
      expect(checks.length).toBe(2);
      expect(checks[0].getAttribute('aria-label')).toBe('Marcar como leída');
    });

    it('la acción navega a la entidad con un enlace real y marca la notificación', async () => {
      await renderizar();
      const enlace = fixture.nativeElement.querySelector('a.btn-accion') as HTMLAnchorElement;
      expect(enlace.getAttribute('href')).toBe('/revisiones/7');
      enlace.click();
      expect(marcarLeida).toHaveBeenCalledWith(1);
    });

    it('marcar como leída desde ✓ reduce el contador de la campana sin recargar', async () => {
      await renderizar();
      (fixture.nativeElement.querySelector('.btn-check') as HTMLButtonElement).click();
      expect(marcarLeida).toHaveBeenCalledWith(1);
      expect(noLeidas()).toBe(1);
    });

    it('el filtro sin coincidencias muestra el estado vacío', async () => {
      await renderizar();
      chip('Incidencias')?.click();
      fixture.detectChanges();
      expect(texto()).toContain('Estás al día');
      expect(texto()).toContain('No hay notificaciones en este filtro.');
    });
  });

  describe('acciones sin entidad', () => {
    it('una notificación general no muestra botón de acción', async () => {
      configurar([nueva(1, 'MENSAJE_GESTOR', true, hoy, null)]);
      await renderizar();
      expect(fixture.nativeElement.querySelector('a.btn-accion')).toBeNull();
    });
  });

  describe('códigos internos y roles', () => {
    it('no muestra códigos EP/HU en textos visibles', async () => {
      configurar([nueva(1, 'NUEVA_PRACTICA', false)]);
      await renderizar();
      expect(codigosInternosVisibles(fixture.nativeElement)).toEqual([]);
    });

    it('el ADMINISTRADOR no recibe la presentación nueva del gestor', async () => {
      configurar([nueva(1, 'NUEVA_PRACTICA', false)], ['ADMINISTRADOR']);
      await renderizar();
      expect(fixture.nativeElement.querySelector('.notif-gestor')).toBeNull();
      expect(texto()).toContain('Activar push en este dispositivo');
    });
  });
});
