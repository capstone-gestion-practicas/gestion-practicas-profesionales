import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { NotificacionService } from '../../core/services/notificacion.service';
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
});
