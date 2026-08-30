import { TestBed } from '@angular/core/testing';

import { ContextoUsuarioResponse } from '../models/auth.models';
import { AuthStore } from './auth.store';

describe('AuthStore', () => {
  let store: AuthStore;

  const contexto: ContextoUsuarioResponse = {
    usuario: {
      id_usuario: 1,
      nombre: 'Usuario',
      apellido: 'Demo',
      correo: 'demo@practicalink.cl'
    },
    roles: ['ESTUDIANTE'],
    perfil: null,
    practica_actual: null
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(AuthStore);
  });

  it('starts without a user context', () => {
    expect(store.obtenerContextoActual()).toBeNull();
  });

  it('sets and clears the user context', () => {
    store.setContexto(contexto);
    expect(store.obtenerContextoActual()).toEqual(contexto);

    store.limpiar();
    expect(store.obtenerContextoActual()).toBeNull();
  });
});
