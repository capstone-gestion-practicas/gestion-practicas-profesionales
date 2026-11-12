import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { AsignacionDocenteDetalle, DocenteService } from '../../docente/docente.service';
import { DocenteAsignacion } from './docente-asignacion';

/** Etapa 3e: errores de la carga inicial visibles, accesibles y con reintento solo si es útil. */
describe('DocenteAsignacion · errores de carga (etapa 3e)', () => {
  let fixture: ComponentFixture<DocenteAsignacion>;
  let component: DocenteAsignacion;
  let api: jasmine.SpyObj<DocenteService>;
  const docente = { id_usuario: 22, nombre: 'Docente sintético', correo: 'docente@example.invalid' };
  const asignacion: AsignacionDocenteDetalle = { id_practica: 15, docente_actual: null, docentes_disponibles: [docente] };

  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const alertas = (): string[] =>
    Array.from(raiz().querySelectorAll('[role="alert"]')).map(alerta => alerta.textContent?.trim() ?? '');
  const reintentar = (): HTMLElement | undefined =>
    Array.from(raiz().querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(boton => boton.textContent?.trim() === 'Reintentar');

  const fallo = (status: number, detail = 'SQLSTATE P0409 detalle interno') =>
    throwError(() => new HttpErrorResponse({ status, error: { detail } }));

  beforeEach(async () => {
    api = jasmine.createSpyObj<DocenteService>('DocenteService', ['consultarAsignacion', 'asignar']);
    await TestBed.configureTestingModule({ imports: [DocenteAsignacion], providers: [
      { provide: DocenteService, useValue: api }
    ] }).compileComponents();
    fixture = TestBed.createComponent(DocenteAsignacion);
    fixture.componentRef.setInput('idPractica', 15);
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  const definitivos: [number, string][] = [
    [401, 'Tu sesión no es válida. Inicia sesión nuevamente.'],
    [403, 'Solo el GESTOR responsable puede gestionar esta asignación.'],
    [404, 'No se encontró la práctica.'],
    [409, 'El estado actual no permite asignar docentes.']
  ];
  for (const [status, mensaje] of definitivos) {
    it(`${status}: muestra un único aviso accesible, sin reintento ni formulario`, () => {
      api.consultarAsignacion.and.returnValue(fallo(status));
      fixture.detectChanges();
      expect(alertas()).toEqual([mensaje]);
      expect(reintentar()).toBeUndefined();
      expect(raiz().querySelector('form')).toBeNull();
      expect(raiz().textContent).not.toContain('Sin docente');
      expect(raiz().textContent).not.toContain('SQLSTATE');
    });
  }

  for (const status of [0, 500, 503]) {
    it(`${status}: muestra el error genérico y permite reintentar hasta recuperar la asignación`, () => {
      api.consultarAsignacion.and.returnValue(fallo(status));
      fixture.detectChanges();
      expect(alertas()).toEqual(['No fue posible consultar la asignación.']);
      expect(raiz().textContent).not.toContain('SQLSTATE');
      expect(reintentar()).toBeDefined();

      api.consultarAsignacion.and.returnValue(of(asignacion));
      reintentar()!.click();
      fixture.detectChanges();
      expect(api.consultarAsignacion).toHaveBeenCalledTimes(2);
      expect(alertas()).toEqual([]);
      expect(reintentar()).toBeUndefined();
      expect(raiz().querySelector('form')).not.toBeNull();
      expect(raiz().textContent).toContain('Sin docente');
    });
  }

  it('el reintento muestra el estado de carga y no duplica solicitudes en curso', () => {
    api.consultarAsignacion.and.returnValue(fallo(500));
    fixture.detectChanges();
    const pendiente = new Subject<AsignacionDocenteDetalle>();
    api.consultarAsignacion.and.returnValue(pendiente);
    component.cargar();
    component.cargar();
    fixture.detectChanges();
    expect(api.consultarAsignacion).toHaveBeenCalledTimes(2);
    expect(raiz().querySelector('[role="status"]')?.textContent).toContain('Consultando asignación');
    expect(alertas()).toEqual([]);
    pendiente.next(asignacion);
    pendiente.complete();
    fixture.detectChanges();
    expect(raiz().querySelector('form')).not.toBeNull();
  });

  it('un reintento fallido de nuevo vuelve a mostrar un solo aviso', () => {
    api.consultarAsignacion.and.returnValue(fallo(503));
    fixture.detectChanges();
    reintentar()!.click();
    fixture.detectChanges();
    expect(api.consultarAsignacion).toHaveBeenCalledTimes(2);
    expect(alertas()).toEqual(['No fue posible consultar la asignación.']);
  });

  it('cancela la carga pendiente al destruirse', () => {
    const pendiente = new Subject<AsignacionDocenteDetalle>();
    api.consultarAsignacion.and.returnValue(pendiente);
    fixture.detectChanges();
    fixture.destroy();
    expect(pendiente.observed).toBeFalse();
  });

  it('un error al guardar se muestra una sola vez dentro del formulario', () => {
    api.consultarAsignacion.and.returnValue(of(asignacion));
    fixture.detectChanges();
    component.idDocente = '22';
    api.asignar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    component.guardar();
    fixture.detectChanges();
    expect(alertas()).toEqual(['Solo el GESTOR responsable puede modificar esta asignación.']);
    expect(reintentar()).toBeUndefined();
  });
});
