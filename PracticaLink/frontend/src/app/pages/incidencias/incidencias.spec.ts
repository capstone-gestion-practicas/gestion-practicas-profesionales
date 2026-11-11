import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../environments/environment';
import { Incidencias } from './incidencias';
import { codigosInternosVisibles } from '../../shared/testing/codigos-internos';

describe('Incidencias (pantalla HU016: sin cambio de estado legado)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Incidencias],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function cargarListados(incidencias: unknown[] = []): void {
    http.expectOne(request => request.method === 'GET'
      && request.url === `${environment.apiUrl}/practicas/gestion-estados`).flush([
      { id_practica: 15, estado: 'EN_CURSO', es_final: false, estudiante: 'Estudiante', centro_practica: 'Centro' }
    ]);
    http.expectOne(request => request.method === 'GET'
      && request.url === `${environment.apiUrl}/incidencias`).flush(incidencias);
  }

  it('carga solo con GET y no emite PATCH legado al mostrar incidencias', () => {
    const fixture = TestBed.createComponent(Incidencias);
    fixture.detectChanges();
    cargarListados([{
      id_incidencia: 42, id_practica: 15, id_usuario: 9, usuario: 'Gestor', fecha: '2026-11-01T00:00:00Z',
      descripcion: 'Descripción', prioridad: 'MEDIA', estado: 'PENDIENTE', fecha_resolucion: null,
      alerta: false, estudiante: 'Estudiante', correo_estudiante: null, centro_practica: 'Centro'
    }]);
    fixture.detectChanges();

    expect(http.match(request => request.method === 'PATCH')).toEqual([]);
    const texto: string = fixture.nativeElement.textContent;
    expect(texto).toContain('Estado: PENDIENTE');
    expect(texto).not.toContain('Actualizar estado');
  });

  it('registra con POST EP06 enviando solo tipo y descripcion', () => {
    const fixture = TestBed.createComponent(Incidencias);
    fixture.detectChanges();
    cargarListados();
    fixture.detectChanges();

    const componente = fixture.componentInstance;
    componente.tipo = 'SALUD';
    componente.descripcion = 'Ausencia por salud';
    componente.registrar();

    const alta = http.expectOne(`${environment.apiUrl}/practicas/15/incidencias`);
    expect(alta.request.method).toBe('POST');
    expect(alta.request.body).toEqual({ tipo: 'SALUD', descripcion: 'Ausencia por salud' });
    alta.flush({
      id_incidencia: 77, id_practica: 15, id_usuario: 9, tipo: 'SALUD',
      descripcion: 'Ausencia por salud', estado: 'PENDIENTE', fecha: '2026-11-02T00:00:00Z'
    });
    // Tras crear se recarga la lista legada, no se inserta la respuesta EP06.
    cargarListados();
  });

  it('no muestra códigos internos y usa las etiquetas de atención, incluido el registro', () => {
    const fixture = TestBed.createComponent(Incidencias);
    fixture.detectChanges();
    cargarListados([]);
    fixture.detectChanges();
    expect(codigosInternosVisibles(fixture.nativeElement)).toEqual([]);
    expect(fixture.nativeElement.querySelector('.module-label')?.textContent?.trim()).toBe('ATENCIÓN');
    expect(fixture.nativeElement.textContent).toContain('Registrar incidencia');
  });

  it('no registra incidencias con la práctica fuera de EN_CURSO y muestra el motivo', () => {
    const fixture = TestBed.createComponent(Incidencias);
    fixture.detectChanges();
    http.expectOne(request => request.method === 'GET'
      && request.url === `${environment.apiUrl}/practicas/gestion-estados`).flush([
      { id_practica: 16, estado: 'APROBADA', es_final: false, estudiante: 'Otro', centro_practica: 'Centro' }
    ]);
    http.expectOne(request => request.method === 'GET'
      && request.url === `${environment.apiUrl}/incidencias`).flush([]);
    fixture.detectChanges();

    const componente = fixture.componentInstance;
    componente.practicaSeleccionada = 16;
    componente.tipo = 'SALUD';
    componente.descripcion = 'Ausencia por salud';
    expect(componente.puedeRegistrar()).toBeFalse();
    componente.registrar();
    http.expectNone(`${environment.apiUrl}/practicas/16/incidencias`);
    expect(componente.error).toContain('Las incidencias se registran cuando la práctica está en curso.');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Las incidencias se registran cuando la práctica está en curso.');
  });
});
