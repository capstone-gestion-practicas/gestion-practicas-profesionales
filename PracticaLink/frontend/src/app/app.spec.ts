import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthStore } from './core/store/auth.store';
import { NotificacionService } from './features/notificaciones/services/notificacion.service';
import { App } from './app';

describe('App', () => {
  const notificacionService = {
    noLeidas: signal(0),
    notificacionAbiertaPorPush: signal(null),
    iniciarPush: jasmine.createSpy('iniciarPush').and.resolveTo(undefined),
    conectarRealtime: jasmine.createSpy('conectarRealtime').and.returnValue(of()),
    listar: jasmine.createSpy('listar').and.returnValue(of({
      no_leidas: 0,
      notificaciones: []
    })),
    desconectarRealtime: jasmine.createSpy('desconectarRealtime'),
    esAndroid: jasmine.createSpy('esAndroid').and.returnValue(false),
    realtimeConectado: jasmine.createSpy('realtimeConectado').and.returnValue(false)
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        AuthStore,
        { provide: NotificacionService, useValue: notificacionService }
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('ion-router-outlet')).not.toBeNull();
  });
});
