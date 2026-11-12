import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { AuthStore } from '../../../../core/store/auth.store';
import { PracticaService } from '../../../../core/services/practica.service';

import { NotificacionService } from '../../services/notificacion.service';
import { EnvioNotificaciones } from './envio-notificaciones';

describe('EnvioNotificaciones', () => {
  let fixture: ComponentFixture<EnvioNotificaciones>;
  let component: EnvioNotificaciones;
  let servicio: jasmine.SpyObj<NotificacionService>;

  beforeEach(async () => {
    servicio = jasmine.createSpyObj<NotificacionService>(
      'NotificacionService',
      ['listarDestinatariosPush', 'enviarMensajePersonalizado', 'enviarBroadcastPersonalizado']
    );
    servicio.listarDestinatariosPush.and.returnValue(of([
      { id_usuario: 1, nombre: 'Estudiante Uno' },
      { id_usuario: 2, nombre: 'Estudiante Dos' }
    ]));
    servicio.enviarMensajePersonalizado.and.returnValue(of({
      id_notificacion: 10,
      dispositivos_enviados: 1,
      mensaje: 'Mensaje enviado.'
    }));
    servicio.enviarBroadcastPersonalizado.and.returnValue(of({
      destinatarios: 2,
      dispositivos_enviados: 2,
      mensaje: 'Mensaje enviado a 2 estudiantes.'
    }));

    await TestBed.configureTestingModule({
      imports: [EnvioNotificaciones],
      providers: [
        { provide: NotificacionService, useValue: servicio },
        { provide: PracticaService, useValue: { listarEstudiantesSinPractica: () => of([]) } },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(EnvioNotificaciones);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads active recipients in the dedicated send screen', () => {
    expect(fixture.nativeElement.textContent).toContain('Enviar notificaciones');
    expect(component.destinatarios.length).toBe(2);
    expect(component.destinatarioId).toBe('1');
  });

  it('requires a title and message before sending', () => {
    component.enviar();

    expect(component.error).toBe('Completa el título y el mensaje.');
    expect(servicio.enviarMensajePersonalizado).not.toHaveBeenCalled();
  });

  it('sends an individual notification and reports the result', () => {
    component.titulo = '  Recordatorio  ';
    component.mensaje = '  Revisa tu práctica.  ';
    component.enviar();

    expect(servicio.enviarMensajePersonalizado).toHaveBeenCalledWith({
      id_usuario: 1,
      titulo: 'Recordatorio',
      mensaje: 'Revisa tu práctica.'
    });
    expect(component.estadoEnvio).toBe('Mensaje enviado.');
    expect(component.titulo).toBe('');
    expect(component.mensaje).toBe('');
  });
  it('GESTOR integra recordatorios una sola vez; ADMINISTRADOR conserva su pantalla', () => {
    const auth = TestBed.inject(AuthStore);
    const usuario = { id_usuario: 1, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.invalid' };
    auth.setContexto({ usuario, roles: ['GESTOR'], perfil: null, practica_actual: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('app-recordatorios-estudiantes').length).toBe(1);
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Comunicaciones');
    auth.setContexto({ usuario, roles: ['ADMINISTRADOR'], perfil: null, practica_actual: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-recordatorios-estudiantes')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Enviar notificaciones');
  });
  it('no duplica avisos mientras un envío sigue en curso', () => {
    const pendiente = new Subject<{ id_notificacion: number; dispositivos_enviados: number; mensaje: string }>();
    servicio.enviarMensajePersonalizado.and.returnValue(pendiente);
    component.titulo = 'Aviso sintético'; component.mensaje = 'Mensaje sintético';
    component.enviar(); component.enviar();
    expect(servicio.enviarMensajePersonalizado).toHaveBeenCalledTimes(1);
  });
  it('la cuenta multirrol solo ve recordatorios cuando elige el espacio GESTOR', () => {
    const previo = sessionStorage.getItem('practicalink-workspace');
    try {
      TestBed.inject(AuthStore).setContexto({ usuario: { id_usuario: 1, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.invalid' }, roles: ['GESTOR', 'ADMINISTRADOR'], perfil: null, practica_actual: null });
      for (const [espacio, cantidad] of [['GESTOR', 1], ['ADMINISTRADOR', 0]] as const) {
        sessionStorage.setItem('practicalink-workspace', espacio);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('app-recordatorios-estudiantes').length).toBe(cantidad);
      }
    } finally {
      if (previo === null) sessionStorage.removeItem('practicalink-workspace');
      else sessionStorage.setItem('practicalink-workspace', previo);
    }
  });
});
