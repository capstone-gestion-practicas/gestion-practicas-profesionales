import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { EstudianteService } from '../../../core/services/estudiante.service';
import { AuthStore } from '../../../core/store/auth.store';
import { PerfilEstudianteWorkflowService } from './perfil-estudiante-workflow.service';

describe('PerfilEstudianteWorkflowService', () => {
  it('completa el perfil, refresca el contexto y actualiza AuthStore', (done) => {
    const estudiante = jasmine.createSpyObj<EstudianteService>('EstudianteService', ['completarPerfil']);
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['obtenerContexto']);
    const contexto: ContextoUsuarioResponse = {
      usuario: { id_usuario: 1, nombre: 'Ana', apellido: 'Prueba', correo: 'ana@example.test' },
      roles: ['ESTUDIANTE'],
      perfil: { id_estudiante: 8, rut: '12345678-5', carrera: 'Ingeniería', sede: 'Central' },
      practica_actual: null
    };
    estudiante.completarPerfil.and.returnValue(of({ id_estudiante: 8, mensaje: 'Completado' }));
    auth.obtenerContexto.and.returnValue(of(contexto));
    TestBed.configureTestingModule({ providers: [
      AuthStore,
      { provide: EstudianteService, useValue: estudiante },
      { provide: AuthService, useValue: auth }
    ] });
    const store = TestBed.inject(AuthStore);
    TestBed.inject(PerfilEstudianteWorkflowService).completar({
      rut: '12345678-5', carrera: 'Ingeniería', sede: 'Central', telefono: null, direccion: null
    }).subscribe({
      next: resultado => {
        expect(resultado).toEqual(contexto);
        expect(store.contexto()).toEqual(contexto);
        expect(estudiante.completarPerfil).toHaveBeenCalledTimes(1);
        expect(auth.obtenerContexto).toHaveBeenCalledTimes(1);
        done();
      },
      error: done.fail
    });
  });
});
