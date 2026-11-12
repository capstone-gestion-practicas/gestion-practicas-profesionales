import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { Subject, of, throwError } from 'rxjs';
import { AuthStore } from '../../../../core/store/auth.store';
import { Notificacion, NotificacionesResumen } from '../../models/notificacion.models';
import { NotificacionService } from '../../services/notificacion.service';
import { Notificaciones } from './notificaciones';

describe('Centro de notificaciones del ADMINISTRADOR', () => {
  let fixture: ComponentFixture<Notificaciones>;
  let component: Notificaciones;
  let servicio: jasmine.SpyObj<NotificacionService>;
  let estadoPush: ReturnType<typeof signal<'inactivo' | 'registrando' | 'registrado' | 'error'>>;
  let noLeidas: ReturnType<typeof signal<number>>;
  const aviso = (id: number, leida = false, tipo = 'NUEVA_PRACTICA', practica: number | null = 15): Notificacion => ({
    id_notificacion: id, id_practica: practica, tipo, titulo: `Aviso ${id}`, mensaje: `Descripción ${id}`,
    fecha_creacion: '2026-11-12T12:00:00Z', fecha_leida: leida ? '2026-11-12T13:00:00Z' : null
  });
  const texto = (): string => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
  const tarjetas = (): NodeListOf<HTMLElement> => fixture.nativeElement.querySelectorAll('.admin-aviso');

  beforeEach(async () => {
    sessionStorage.clear();
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
    spyOn(Capacitor, 'getPlatform').and.returnValue('web');
    noLeidas = signal(0); estadoPush = signal<'inactivo' | 'registrando' | 'registrado' | 'error'>('inactivo');
    servicio = Object.assign(jasmine.createSpyObj<NotificacionService>('NotificacionService',
      ['listar', 'marcarLeida', 'marcarTodasLeidas', 'pedirPermisoPush']), { noLeidas, estadoRegistroPush: estadoPush });
    servicio.listar.and.returnValue(of({ notificaciones: [aviso(1), aviso(2, true)], no_leidas: 1 }));
    servicio.marcarLeida.and.returnValue(of(undefined));
    servicio.marcarTodasLeidas.and.returnValue(of({ actualizadas: 1 }));
    servicio.pedirPermisoPush.and.resolveTo(true);
    await TestBed.configureTestingModule({ imports: [Notificaciones], providers: [provideIonicAngular(), provideRouter([]),
      { provide: NotificacionService, useValue: servicio }]
    }).compileComponents();
    TestBed.inject(AuthStore).setContexto({ usuario: { id_usuario: 1, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.invalid' }, roles: ['ADMINISTRADOR'], perfil: null, practica_actual: null });
  });
  afterEach(() => { fixture?.destroy(); sessionStorage.clear(); });
  function crear(): void {
    fixture = TestBed.createComponent(Notificaciones); component = fixture.componentInstance; fixture.detectChanges();
  }

  it('presenta tarjetas compactas, estados, iconos, fecha y controles nativos accesibles', () => {
    crear();
    expect(tarjetas().length).toBe(2);
    expect(tarjetas()[0].classList).toContain('admin-aviso--no-leido');
    expect(tarjetas()[1].classList).not.toContain('admin-aviso--no-leido');
    expect(texto()).toContain('1 sin leer');
    expect(texto()).toContain('Descripción 1');
    expect((tarjetas()[0].querySelector('ion-icon') as HTMLIonIconElement).name).toBe('document-text-outline');
    expect(tarjetas()[0].querySelector('time')?.getAttribute('datetime')).toBe('2026-11-12T12:00:00Z');
    const abrir = tarjetas()[0].querySelector('button') as HTMLButtonElement;
    expect(abrir.type).toBe('button');
    expect(abrir.getAttribute('aria-label')).toContain('No leída');
    expect(abrir.getAttribute('aria-describedby')).toContain('aviso-mensaje-1');
    expect(texto()).not.toContain('Volver al inicio');
  });

  it('filtra datos cargados, informa vacíos del filtro y no vuelve a consultar', () => {
    crear();
    const filtro = fixture.nativeElement.querySelectorAll('.notif-admin__filtros button')[1] as HTMLButtonElement;
    filtro.click(); fixture.detectChanges();
    expect(filtro.getAttribute('aria-pressed')).toBe('true');
    expect(tarjetas().length).toBe(1);
    component.marcarTodas(); fixture.detectChanges();
    expect(tarjetas().length).toBe(0);
    expect(texto()).toContain('No tienes notificaciones sin leer en la lista cargada.');
    expect(noLeidas()).toBe(0);
    component.elegirFiltro('todas'); fixture.detectChanges();
    expect(tarjetas().length).toBe(2);
    expect(component.notificaciones.every(item => item.fecha_leida !== null)).toBeTrue();
    expect(servicio.listar).toHaveBeenCalledTimes(1);
  });

  it('distingue bandeja vacía, carga y error sin afirmar cero pendientes ante un fallo', () => {
    const respuesta = new Subject<NotificacionesResumen>();
    servicio.listar.and.returnValue(respuesta); crear();
    expect(texto()).toContain('Cargando tu bandeja');
    expect(texto()).not.toContain('0 sin leer');
    respuesta.error(new Error('synthetic network failure')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(texto()).toContain('Cantidad sin leer no disponible');
    expect(texto()).not.toContain('No tienes notificaciones todavía');
    servicio.listar.and.returnValue(of({ notificaciones: [], no_leidas: 0 }));
    const reintentar = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(boton => boton.textContent?.trim() === 'Reintentar');
    reintentar?.click(); fixture.detectChanges();
    expect(texto()).toContain('No tienes notificaciones todavía.');
    expect(servicio.listar).toHaveBeenCalledTimes(2);
  });

  it('actualiza lecturas una sola vez, incluso con clics repetidos, y navega a supervisión', () => {
    const lectura = new Subject<void>(); servicio.marcarLeida.and.returnValue(lectura); crear();
    const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    component.abrir(component.notificaciones[0]); component.abrir(component.notificaciones[0]);
    expect(servicio.marcarLeida).toHaveBeenCalledOnceWith(1);
    expect(noLeidas()).toBe(1);
    lectura.next(); lectura.complete(); fixture.detectChanges();
    expect(noLeidas()).toBe(0);
    expect(navegar).toHaveBeenCalledOnceWith(['/practicas', 15]);
    component.abrir(component.notificaciones[0]);
    expect(servicio.marcarLeida).toHaveBeenCalledTimes(1);
    expect(noLeidas()).toBe(0);
  });

  it('no inventa lecturas exitosas si falla el marcado individual o masivo', () => {
    servicio.marcarTodasLeidas.and.returnValue(throwError(() => new Error('synthetic')));
    servicio.marcarLeida.and.returnValue(throwError(() => new Error('synthetic'))); crear();
    component.marcarTodas(); fixture.detectChanges();
    expect(noLeidas()).toBe(1); expect(component.errorLectura).toContain('No fue posible');
    const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    component.abrir(component.notificaciones[0]);
    expect(component.notificaciones[0].fecha_leida).toBeNull();
    expect(noLeidas()).toBe(1);
    expect(navegar).toHaveBeenCalledWith(['/practicas', 15]);
  });

  it('conserva destinos administrativos sin enviar ADMINISTRADOR a rutas exclusivas del GESTOR', () => {
    crear(); const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    for (const tipo of ['NUEVA_PRACTICA', 'RESPUESTA_OBSERVACION', 'CAMBIO_ESTADO', 'PRACTICA_INICIADA', 'PRACTICA_FINALIZADA', 'INCIDENCIA_CRITICA', 'GESTOR_ASIGNADO']) {
      navegar.calls.reset(); component.abrir(aviso(3, true, tipo));
      expect(navegar).withContext(tipo).toHaveBeenCalledOnceWith(['/practicas', 15]);
    }
    navegar.calls.reset(); component.abrir(aviso(4, true, 'MENSAJE_GESTOR', null));
    expect(navegar).not.toHaveBeenCalled();
    expect(component.accionDe(aviso(5, false, 'NUEVA_PRACTICA', null))).toBeNull();
  });

  it('no muestra preferencias ni su texto, ni pide permisos web o registra Android desde el navegador', async () => {
    const permisoWeb = spyOn(Notification, 'requestPermission').and.resolveTo('granted');
    crear();
    expect(texto()).not.toContain('Preferencias de notificaciones');
    expect(texto()).not.toContain('Web Push');
    expect(texto()).not.toContain('APK Android');
    expect(texto()).not.toContain('Los avisos guardados en la bandeja');
    expect(fixture.nativeElement.querySelector('.notif-admin__preferencias')).toBeNull();
    await component.activarPushAdministrador();
    expect(permisoWeb).not.toHaveBeenCalled();
    expect(servicio.pedirPermisoPush).not.toHaveBeenCalled();
    expect(servicio.estadoRegistroPush()).toBe('inactivo');
  });

  it('mantiene la activación Android, los estados reales de registro y evita dobles solicitudes', async () => {
    (Capacitor.isNativePlatform as jasmine.Spy).and.returnValue(true);
    (Capacitor.getPlatform as jasmine.Spy).and.returnValue('android');
    let resolver!: (valor: boolean) => void;
    servicio.pedirPermisoPush.and.returnValue(new Promise<boolean>(resolve => { resolver = resolve; }));
    crear();
    expect(texto()).not.toContain('Preferencias de notificaciones');
    expect(texto()).not.toContain('Activar notificaciones en Android');
    const activacion = component.activarPushAdministrador(); await component.activarPushAdministrador();
    expect(servicio.pedirPermisoPush).toHaveBeenCalledOnceWith(1);
    resolver(true); estadoPush.set('registrando'); await activacion; fixture.detectChanges();
    expect(servicio.estadoRegistroPush()).toBe('registrando');
    expect(component.mensajePush).toContain('Registrando el dispositivo');
    estadoPush.set('registrado'); fixture.detectChanges();
    expect(servicio.estadoRegistroPush()).toBe('registrado');
    await component.activarPushAdministrador();
    expect(servicio.pedirPermisoPush).toHaveBeenCalledTimes(1);
  });

  it('conserva mensajes de permiso Android denegado y error de registro sin declarar push activado', async () => {
    (Capacitor.isNativePlatform as jasmine.Spy).and.returnValue(true);
    (Capacitor.getPlatform as jasmine.Spy).and.returnValue('android');
    servicio.pedirPermisoPush.and.resolveTo(false); crear();
    await component.activarPushAdministrador(); fixture.detectChanges();
    expect(component.mensajePush).toContain('Permiso denegado');
    expect(texto()).not.toContain('Este dispositivo quedó registrado');
    spyOn(console, 'warn');
    servicio.pedirPermisoPush.and.rejectWith(new Error('synthetic registration failure'));
    estadoPush.set('error'); await component.activarPushAdministrador(); fixture.detectChanges();
    expect(component.mensajePush).toContain('No fue posible iniciar las notificaciones push');
    expect(servicio.estadoRegistroPush()).toBe('error');
    expect(texto()).not.toContain('Este dispositivo quedó registrado');
  });

  it('mantiene separados GESTOR y ADMINISTRADOR en cuentas multirrol sin convertir preferencias en autorización', () => {
    const auth = TestBed.inject(AuthStore);
    auth.setContexto({ ...auth.contexto()!, roles: ['GESTOR', 'ADMINISTRADOR'] });
    sessionStorage.setItem('practicalink-workspace', 'ADMINISTRADOR'); crear();
    expect(component.presentacionAdministrador).toBeTrue();
    sessionStorage.setItem('practicalink-workspace', 'GESTOR'); fixture.detectChanges();
    expect(component.presentacionAdministrador).toBeFalse();
    expect(fixture.nativeElement.querySelector('.notif-admin')).toBeNull();
    auth.setContexto({ ...auth.contexto()!, roles: ['GESTOR'] });
    sessionStorage.setItem('practicalink-workspace', 'ADMINISTRADOR'); fixture.detectChanges();
    expect(component.presentacionAdministrador).toBeFalse();
    expect(component.presentacionGestor).toBeTrue();
  });
});
