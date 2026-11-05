import { TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { of, throwError } from 'rxjs';

import { ContextoUsuarioResponse } from '../../../../core/models/auth.models';
import { PerfilEstudianteWorkflowService } from '../../services/perfil-estudiante-workflow.service';
import { CompletarPerfilModal } from './completar-perfil-modal';

describe('CompletarPerfilModal', () => {
  let component: CompletarPerfilModal;
  let workflow: jasmine.SpyObj<PerfilEstudianteWorkflowService>;
  let modalController: jasmine.SpyObj<ModalController>;

  const contexto: ContextoUsuarioResponse = {
    usuario: { id_usuario: 1, nombre: 'Ana', apellido: 'Prueba', correo: 'ana@example.test' },
    roles: ['ESTUDIANTE'], perfil: null, practica_actual: null
  };

  beforeEach(() => {
    workflow = jasmine.createSpyObj<PerfilEstudianteWorkflowService>('PerfilEstudianteWorkflowService', ['completar']);
    workflow.completar.and.returnValue(of(contexto));
    modalController = jasmine.createSpyObj<ModalController>('ModalController', ['dismiss']);
    modalController.dismiss.and.returnValue(Promise.resolve(true));
    TestBed.configureTestingModule({
      imports: [CompletarPerfilModal],
      providers: [
        { provide: PerfilEstudianteWorkflowService, useValue: workflow },
        { provide: ModalController, useValue: modalController }
      ]
    });
    component = TestBed.createComponent(CompletarPerfilModal).componentInstance;
  });

  it('valida campos obligatorios y el RUT antes de enviar', () => {
    component.guardar();
    expect(component.error).toContain('obligatorios');
    component.rut = 'inválido';
    component.carrera = 'Ingeniería';
    component.sede = 'Central';
    component.guardar();
    expect(component.error).toContain('RUT válido');
    expect(workflow.completar).not.toHaveBeenCalled();
  });

  it('normaliza los datos, reutiliza el workflow y cierra tras completar', () => {
    component.rut = '12345678-5';
    component.carrera = ' Ingeniería ';
    component.sede = ' Central ';
    component.telefono = '   ';
    component.direccion = ' Calle 1 ';
    component.guardar();
    expect(workflow.completar).toHaveBeenCalledWith({
      rut: '12.345.678-5', carrera: 'Ingeniería', sede: 'Central', telefono: null, direccion: 'Calle 1'
    });
    expect(modalController.dismiss).toHaveBeenCalledWith({ completado: true });
  });

  it('conserva el modal y muestra un error si falla el workflow', () => {
    workflow.completar.and.returnValue(throwError(() => ({ error: { detail: 'Error validado' } })));
    component.rut = '12345678-5';
    component.carrera = 'Ingeniería';
    component.sede = 'Central';
    component.guardar();
    expect(component.error).toBe('Error validado');
    expect(modalController.dismiss).not.toHaveBeenCalled();
  });
});
