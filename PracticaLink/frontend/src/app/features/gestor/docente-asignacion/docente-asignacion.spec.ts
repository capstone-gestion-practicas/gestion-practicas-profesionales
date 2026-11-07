import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { AsignacionDocenteDetalle, AsignacionDocenteResultado, DocenteService } from '../../docente/docente.service';
import { DocenteAsignacion } from './docente-asignacion';

describe('Asignación docente por GESTOR', () => {
  let fixture: ComponentFixture<DocenteAsignacion>;
  let component: DocenteAsignacion;
  let api: jasmine.SpyObj<DocenteService>;
  const docente = { id_usuario: 22, nombre: 'Docente sintético', correo: 'docente@example.invalid' };
  const anterior = { id_usuario: 21, nombre: 'Docente anterior', correo: 'anterior@example.invalid' };
  const vacia: AsignacionDocenteDetalle = { id_practica: 15, docente_actual: null, docentes_disponibles: [docente] };
  beforeEach(async () => {
    api = jasmine.createSpyObj<DocenteService>('DocenteService', ['consultarAsignacion', 'asignar']);
    api.consultarAsignacion.and.returnValue(of(vacia));
    await TestBed.configureTestingModule({ imports: [DocenteAsignacion], providers: [
      { provide: DocenteService, useValue: api }
    ] }).compileComponents();
    fixture = TestBed.createComponent(DocenteAsignacion);
    fixture.componentRef.setInput('idPractica', 15);
    component = fixture.componentInstance;
  });
  afterEach(() => fixture.destroy());

  it('mantiene carga hasta recibir la asignación y muestra al docente actual', () => {
    const respuesta = new Subject<AsignacionDocenteDetalle>();
    api.consultarAsignacion.and.returnValue(respuesta);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Consultando asignación');
    expect(api.consultarAsignacion).toHaveBeenCalledOnceWith(15);
    respuesta.next({ ...vacia, docente_actual: anterior }); respuesta.complete(); fixture.detectChanges();
    expect(component.cargando).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain(anterior.nombre);
  });
  it('asigna sin motivo inicial y actualiza la vista solo tras confirmar el servidor', () => {
    fixture.detectChanges();
    const respuesta = new Subject<AsignacionDocenteResultado>();
    api.asignar.and.returnValue(respuesta);
    component.idDocente = '22'; component.guardar(); fixture.detectChanges();
    expect(api.asignar).toHaveBeenCalledOnceWith(15, 22, null);
    expect(component.enviando).toBeTrue();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    api.consultarAsignacion.and.returnValue(of({ ...vacia, docente_actual: docente }));
    respuesta.next({ id_practica: 15, id_docente: 22, id_docente_anterior: null, mensaje: 'Asignado' });
    respuesta.complete(); fixture.detectChanges();
    expect(component.enviando).toBeFalse();
    expect(api.consultarAsignacion).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain(docente.nombre);
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Docente 22 asignado');
  });
  for (const retirar of [false, true]) {
    it(`${retirar ? 'retira' : 'reemplaza'} con motivo y conserva la asignación ante motivo rechazado por backend`, () => {
      api.consultarAsignacion.and.returnValue(of({ ...vacia, docente_actual: anterior }));
      fixture.detectChanges();
      component.idDocente = retirar ? '__RETIRAR__' : '22';
      api.asignar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 422 })));
      component.guardar(); fixture.detectChanges();
      expect(api.asignar).toHaveBeenCalledWith(15, retirar ? null : 22, null);
      expect(component.asignacion?.docente_actual).toEqual(anterior);
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('motivo es obligatorio');
      expect(component.enviando).toBeFalse();
      component.motivo = '  Cambio académico sintético  ';
      api.asignar.and.returnValue(of({ id_practica: 15, id_docente: retirar ? null : 22, id_docente_anterior: 21, mensaje: 'Actualizado' }));
      api.consultarAsignacion.and.returnValue(of({ ...vacia, docente_actual: retirar ? null : docente }));
      component.guardar(); fixture.detectChanges();
      expect(api.asignar).toHaveBeenCalledWith(15, retirar ? null : 22, 'Cambio académico sintético');
      expect(fixture.nativeElement.textContent).toContain(retirar ? 'Sin docente' : docente.nombre);
      expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain(retirar ? 'retirada' : 'asignado');
      expect(component.motivo).toBe('');
    });
  }
  for (const status of [403, 409]) {
    it(`maneja ${status} al consultar sin habilitar una asignación`, () => {
      api.consultarAsignacion.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      fixture.detectChanges();
      expect(component.cargando).toBeFalse();
      expect(component.error).toContain(status === 403 ? 'GESTOR responsable' : 'estado actual');
      expect(fixture.nativeElement.querySelector('form')).toBeNull();
      expect(api.asignar).not.toHaveBeenCalled();
    });
    it(`muestra ${status} al guardar sin cambiar la asignación ni mostrar éxito`, () => {
      fixture.detectChanges();
      component.idDocente = '22';
      api.asignar.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      component.guardar(); fixture.detectChanges();
      expect(component.enviando).toBeFalse();
      expect(component.asignacion?.docente_actual).toBeNull();
      expect(api.consultarAsignacion).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(status === 403 ? 'GESTOR responsable' : 'estado actual');
      expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    });
  }
});
