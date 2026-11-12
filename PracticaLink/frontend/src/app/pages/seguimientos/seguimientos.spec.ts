import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { PracticaEstadoResumen } from '../../core/models/practica.models';
import { SeguimientoResponse, SeguimientosHistorialResponse } from '../../core/models/seguimiento.models';
import { PracticaService } from '../../core/services/practica.service';
import { Seguimientos } from './seguimientos';
import { codigosInternosVisibles } from '../../shared/testing/codigos-internos';
import { AuthStore } from '../../core/store/auth.store';

describe('Seguimientos (contrato EP05)', () => {
  let fixture: ComponentFixture<Seguimientos>;
  let component: Seguimientos;
  let service: jasmine.SpyObj<PracticaService>;

  const practica: PracticaEstadoResumen = {
    id_practica: 5, fecha_registro: '2026-01-01T00:00:00Z', fecha_actualizacion: '2026-01-02T00:00:00Z',
    id_estado: 5, estado: 'EN_CURSO', descripcion_estado: null, es_final: false,
    estudiante: 'Estudiante sintético', rut_estudiante: '11111111-1', centro_practica: 'Centro sintético',
    fecha_inicio: '2026-01-05', fecha_termino: '2026-06-30', horas_semanales: 20, id_gestor: 21, gestor: 'Gestor Sintético'
  };

  const historialInicial: SeguimientosHistorialResponse = {
    id_practica: 5, limit: 50, offset: 0, hay_mas: false,
    items: [{ id_seguimiento: 3, fecha: '2026-01-10', tipo: 'Videollamada', observacion: 'Primer avance',
      responsable: { id_usuario: 21, nombre: 'Gestor Sintético' } }]
  };

  const historialTrasAlta: SeguimientosHistorialResponse = {
    id_practica: 5, limit: 50, offset: 0, hay_mas: false,
    items: [
      { id_seguimiento: 4, fecha: '2026-01-15', tipo: 'Llamada telefónica', observacion: 'Nuevo avance',
        responsable: { id_usuario: 21, nombre: 'Gestor Sintético' } },
      { id_seguimiento: 3, fecha: '2026-01-10', tipo: 'Videollamada', observacion: 'Primer avance',
        responsable: { id_usuario: 21, nombre: 'Gestor Sintético' } }
    ]
  };

  const respuestaAlta: SeguimientoResponse = {
    id_seguimiento: 4, id_practica: 5, id_usuario: 21, fecha: '2026-01-15',
    tipo: 'Llamada telefónica', observacion: 'Nuevo avance', fecha_creacion: '2026-01-15T12:00:00Z'
  };

  beforeEach(async () => {
    service = jasmine.createSpyObj<PracticaService>('PracticaService',
      ['listarPracticasParaGestion', 'obtenerSeguimientos', 'registrarSeguimiento']);
    service.listarPracticasParaGestion.and.returnValue(of([practica]));
    service.obtenerSeguimientos.and.returnValue(of(historialInicial));
    service.registrarSeguimiento.and.returnValue(of(new HttpResponse({ body: respuestaAlta, status: 201 })));
    await TestBed.configureTestingModule({
      imports: [Seguimientos],
      providers: [
        { provide: PracticaService, useValue: service },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(Seguimientos);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  function preparar(tipo: string | null, observacion = 'Avance sintético'): void {
    component.fechas.set(practica.id_practica, '2026-01-15');
    component.observaciones.set(practica.id_practica, observacion);
    if (tipo !== null) component.tipos.set(practica.id_practica, tipo);
  }

  it('A: la carga inicial lista prácticas y el historial EP05 se pide al abrirlo', () => {
    expect(service.listarPracticasParaGestion).toHaveBeenCalledTimes(1);
    expect(service.obtenerSeguimientos).not.toHaveBeenCalled();
    component.alternarHistorial(practica);
    expect(service.obtenerSeguimientos).toHaveBeenCalledOnceWith('5');
  });

  it('B: la respuesta paginada se muestra desde items y no como array plano', () => {
    component.alternarHistorial(practica);
    fixture.detectChanges();
    expect(component.historialDe(5)).toEqual(historialInicial.items);
    const texto: string = fixture.nativeElement.textContent;
    expect(texto).toContain('Primer avance');
    expect(texto).toContain('Videollamada');
    expect(texto).toContain('Gestor Sintético');
  });

  it('C: el alta envía exactamente fecha, tipo y observacion mediante el método canónico', () => {
    component.alternarHistorial(practica);
    preparar('Videollamada', '  Avance sintético  ');
    component.registrar(practica);
    expect(service.registrarSeguimiento).toHaveBeenCalledOnceWith('5', {
      fecha: '2026-01-15',
      tipo: 'Videollamada',
      observacion: 'Avance sintético'
    });
    const datos = service.registrarSeguimiento.calls.mostRecent().args[1];
    expect(Object.keys(datos).sort()).toEqual(['fecha', 'observacion', 'tipo']);
  });

  it('D: sin tipo no se envía el POST y se pide seleccionar el medio de contacto', () => {
    preparar(null);
    component.registrar(practica);
    expect(service.registrarSeguimiento).not.toHaveBeenCalled();
    expect(component.error).toContain('Selecciona el medio de contacto');
  });

  it('E: tras un alta exitosa se vuelve a consultar el historial en el backend', () => {
    component.alternarHistorial(practica);
    service.obtenerSeguimientos.and.returnValue(of(historialTrasAlta));
    preparar('Llamada telefónica');
    component.registrar(practica);
    expect(service.obtenerSeguimientos).toHaveBeenCalledTimes(2);
    expect(service.obtenerSeguimientos.calls.mostRecent().args).toEqual(['5']);
    expect(component.historialDe(5)).toEqual(historialTrasAlta.items);
    expect(component.historialDe(5).some(item => item.id_seguimiento === respuestaAlta.id_seguimiento)).toBeTrue();
  });

  it('F: el contrato público nuevo reemplaza los métodos legacy eliminados', () => {
    expect('listarSeguimientos' in PracticaService.prototype).toBeFalse();
    expect('registrarSeguimientoPractica' in PracticaService.prototype).toBeFalse();
    expect(typeof PracticaService.prototype.obtenerSeguimientos).toBe('function');
    expect(typeof PracticaService.prototype.registrarSeguimiento).toBe('function');
  });

  it('no muestra códigos internos y usa la etiqueta de acompañamiento', () => {
    expect(codigosInternosVisibles(fixture.nativeElement)).toEqual([]);
    expect(fixture.nativeElement.querySelector('.module-label')?.textContent?.trim()).toBe('ACOMPAÑAMIENTO');
  });
  it('GESTOR usa el registro existente y el detalle sin otro formulario ni consulta de historial', () => {
    TestBed.inject(AuthStore).setContexto({ usuario: { id_usuario: 21, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.invalid' }, roles: ['GESTOR'], perfil: null, practica_actual: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-textarea')).toBeNull();
    component.abrirRegistro(practica);
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/practicas', 5, 'seguimiento', 'nuevo']);
    component.abrirDetalle(practica);
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/practicas', 5]);
    expect(service.registrarSeguimiento).not.toHaveBeenCalled();
    expect(service.obtenerSeguimientos).not.toHaveBeenCalled();
  });
  it('ADMINISTRADOR conserva formulario e historial en línea', () => {
    TestBed.inject(AuthStore).setContexto({ usuario: { id_usuario: 21, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.invalid' }, roles: ['ADMINISTRADOR'], perfil: null, practica_actual: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-textarea')).not.toBeNull();
  });
});
