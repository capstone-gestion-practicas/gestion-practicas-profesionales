import { NavController } from '@ionic/angular';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { PracticaService } from '../../core/services/practica.service';
import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { IncidenciaResponse, TIPOS_INCIDENCIA } from '../../core/models/incidencia.models';
import { RegistroPractica } from './registro-practica';

const detalle: PracticaDetalleGestionResponse = {
  id_practica: 15, estudiante: { id_estudiante: 7, nombre: 'Prueba' },
  centro_practica: { id_centro: 9, nombre: 'Centro' },
  estado: { id_estado: 3, nombre: 'EN_CURSO', es_final: false },
  fecha_registro: '2026-01-01T12:00:00Z', fecha_ultimo_cambio_estado: null,
  fecha_inicio: null, fecha_termino: null, horas: null, cargo_funcion: null, descripcion: null
};
const registro: IncidenciaResponse = {
  id_incidencia: 1, id_practica: 15, id_usuario: 101, tipo: 'SALUD',
  descripcion: ' Texto ', estado: 'PENDIENTE', fecha: '2026-07-02T03:30:00Z'
};

describe('HU015 formulario remoto', () => {
  let fixture: ComponentFixture<RegistroPractica>;
  let service: jasmine.SpyObj<PracticaService>;
  let component: RegistroPractica;
  let previous: string | null;
  const key = 'practicalink.registros-practica';
  beforeEach(async () => {
    previous = localStorage.getItem(key);
    localStorage.setItem(key, '[{"tipo":"incidencia","id_practica":"15","descripcion":"DEMO NO MOSTRAR"}]');
    service = jasmine.createSpyObj('PracticaService', ['obtenerDetalle', 'registrarIncidencia']);
    service.obtenerDetalle.and.returnValue(of(detalle));
    service.registrarIncidencia.and.returnValue(new Subject<HttpResponse<IncidenciaResponse>>());
    await TestBed.configureTestingModule({ imports: [RegistroPractica], providers: [
      provideRouter([]), { provide: PracticaService, useValue: service },
      { provide: NavController, useValue: jasmine.createSpyObj<NavController>('NavController', ['navigateRoot']) },
      { provide: ActivatedRoute, useValue: {
        snapshot: { data: { tipoRegistro: 'incidencia' } }, paramMap: of(convertToParamMap({ id: '15' }))
      } }
    ] }).compileComponents();
    spyOn(TestBed.inject(Router), 'navigate');
    fixture = TestBed.createComponent(RegistroPractica);
    fixture.detectChanges(); component = fixture.componentInstance;
    component.tipoIncidencia = 'SALUD'; component.descripcionIncidencia = ' Texto ';
  });
  afterEach(() => {
    fixture.destroy();
    if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
  });

  it('has four types, readonly state, no local date or demonstration history', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('#tipo-incidencia option').length).toBe(5);
    expect((element.querySelector('#estado-incidencia') as HTMLInputElement).readOnly).toBeTrue();
    expect(element.querySelector('select#estado-incidencia')).toBeNull();
    expect(element.querySelector('input[type=date]')).toBeNull();
    expect(element.textContent).not.toContain('DEMO NO MOSTRAR');
    expect(element.textContent).toContain('Consulta las incidencias guardadas');
    expect(component.fechaIncidencia).toBe('');
  });

  it('waits for 201, prevents duplicate sends, preserves local data and shows server time in Santiago', () => {
    const pending = new Subject<HttpResponse<IncidenciaResponse>>();
    service.registrarIncidencia.and.returnValue(pending);
    const stored = localStorage.getItem(key);
    const write = spyOn(localStorage, 'setItem');
    component.guardar(); component.guardar();
    expect(component.mensaje).toBe(''); expect(component.guardando).toBeTrue();
    expect(service.registrarIncidencia).toHaveBeenCalledOnceWith('15', { tipo: 'SALUD', descripcion: ' Texto ' });
    pending.next(new HttpResponse({ status: 201, body: registro })); pending.complete();
    fixture.detectChanges();
    expect(component.mensaje).toContain('Incidencia registrada correctamente');
    expect(fixture.nativeElement.querySelector('time').textContent).toBe('01/07/2026, 23:30');
    expect(fixture.nativeElement.querySelector('time').getAttribute('datetime')).toBe(registro.fecha);
    component.guardar(); expect(service.registrarIncidencia).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(stored);
  });

  for (const tipo of TIPOS_INCIDENCIA) {
    it(`accepts ${tipo.codigo} with 2000 Unicode characters`, () => {
      component.tipoIncidencia = tipo.codigo; component.descripcionIncidencia = '😀'.repeat(2000);
      component.guardar();
      expect(service.registrarIncidencia).toHaveBeenCalledOnceWith('15', {
        tipo: tipo.codigo, descripcion: '😀'.repeat(2000)
      });
    });
  }

  it('rejects blank, oversized descriptions and invalid types', () => {
    for (const value of ['', ' \t\n', '😀'.repeat(2001)]) {
      component.descripcionIncidencia = value; component.guardar();
    }
    component.descripcionIncidencia = 'Texto'; component.tipoIncidencia = 'invalido'; component.guardar();
    expect(service.registrarIncidencia).not.toHaveBeenCalled();
  });

  it('disables and refuses registration outside EN_CURSO', () => {
    component.detalle = { ...detalle, estado: { id_estado: 7, nombre: 'FINALIZADA', es_final: true } };
    fixture.detectChanges(); component.guardar();
    expect(service.registrarIncidencia).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('ion-button[type=submit]').disabled).toBeTrue();
    expect(component.error).toContain('EN_CURSO');
  });

  for (const status of [401, 403, 404, 409, 422, 500, 503, 0]) {
    it(`handles ${status} without fallback or automatic retry`, () => {
      service.registrarIncidencia.and.returnValue(throwError(() => new HttpErrorResponse({ status, error: 'SQL INTERNO' })));
      const write = spyOn(localStorage, 'setItem');
      component.guardar();
      expect(component.error).not.toBe(''); expect(component.error).not.toContain('SQL INTERNO');
      expect(component.mensaje).toBe(''); expect(component.fechaIncidencia).toBe('');
      expect(component.guardando).toBeFalse();
      expect(component.incidenciaBloqueada).toBe([0, 500, 503].includes(status));
      expect(service.registrarIncidencia).toHaveBeenCalledTimes(1);
      if (component.incidenciaBloqueada) {
        component.guardar(); expect(service.registrarIncidencia).toHaveBeenCalledTimes(1);
      }
      expect(write).not.toHaveBeenCalled();
      if (status === 401) expect(TestBed.inject(NavController).navigateRoot).toHaveBeenCalledWith(['/login']);
    });
  }

  it('does not invent success or time for an unexpected response', () => {
    for (const response of [new HttpResponse({ status: 200, body: registro }),
      new HttpResponse<IncidenciaResponse>({ status: 201 }),
      new HttpResponse({ status: 201, body: { ...registro, fecha: 'invalid' } })]) {
      component.incidenciaBloqueada = false;
      service.registrarIncidencia.and.returnValue(of(response)); component.guardar();
      expect(component.mensaje).toBe(''); expect(component.fechaIncidencia).toBe('');
      expect(component.incidenciaBloqueada).toBeTrue();
    }
  });
});
