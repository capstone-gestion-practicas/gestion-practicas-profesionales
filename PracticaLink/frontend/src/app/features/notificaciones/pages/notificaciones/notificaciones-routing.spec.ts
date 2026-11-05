import { Router } from '@angular/router';
import { signal } from '@angular/core';

import { AuthStore } from '../../../../core/store/auth.store';
import { Notificacion } from '../../models/notificacion.models';
import { NotificacionService } from '../../services/notificacion.service';
import { Notificaciones } from './notificaciones';

describe('Notificaciones navigation compatibility', () => {
  function create(url: string): { component: Notificaciones; navigate: jasmine.Spy } {
    const router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    Object.defineProperty(router, 'url', { get: () => url });
    const service = {
      noLeidas: signal(0),
      estadoRegistroPush: signal('inactivo'),
      listar: jasmine.createSpy('listar'),
      marcarLeida: jasmine.createSpy('marcarLeida')
    } as unknown as NotificacionService;
    const component = new Notificaciones(service, new AuthStore(), router);
    return { component, navigate: router.navigate as jasmine.Spy };
  }

  it('returns to student home and opens student practice for a status notification', () => {
    const { component, navigate } = create('/estudiante/notificaciones');
    component.volver();
    expect(navigate).toHaveBeenCalledWith(['/estudiante/inicio']);
    navigate.calls.reset();
    const item: Notificacion = {
      id_notificacion: 1, id_practica: 15, tipo: 'CAMBIO_ESTADO', titulo: 'Estado',
      mensaje: 'Cambió el estado', fecha_creacion: '2026-01-01T12:00:00Z', fecha_leida: '2026-01-01T12:01:00Z'
    };
    component.abrir(item);
    expect(navigate).toHaveBeenCalledWith(['/estudiante/mi-practica']);
  });

  it('preserves the legacy /notificaciones destinations', () => {
    const { component, navigate } = create('/notificaciones');
    component.volver();
    expect(navigate).toHaveBeenCalledWith(['/home']);
  });
});
