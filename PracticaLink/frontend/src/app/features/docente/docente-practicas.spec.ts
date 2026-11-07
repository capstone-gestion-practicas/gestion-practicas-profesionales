import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { SesionService } from '../../core/session/sesion.service';
import { DocentePracticas } from './docente-practicas';
import { DocenteService, PracticaDocente } from './docente.service';

describe('Prácticas asignadas al DOCENTE', () => {
  let fixture: ComponentFixture<DocentePracticas>;
  let api: jasmine.SpyObj<DocenteService>;
  const practica: PracticaDocente = {
    id_practica: 15, estado: 'EN_CURSO', estudiante: 'Estudiante sintético',
    centro_practica: 'Centro sintético', fecha_inicio: null, fecha_termino: null,
    cargo_funcion: null, descripcion: null
  };
  async function montar(id: string | null = null): Promise<void> {
    await TestBed.configureTestingModule({ imports: [DocentePracticas], providers: [
      provideRouter([]),
      { provide: DocenteService, useValue: api },
      { provide: SesionService, useValue: jasmine.createSpyObj<SesionService>('SesionService', ['cerrar']) },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(id === null ? {} : { id }) } } }
    ] }).compileComponents();
    fixture = TestBed.createComponent(DocentePracticas);
    fixture.detectChanges();
  }
  beforeEach(() => {
    api = jasmine.createSpyObj<DocenteService>('DocenteService', ['listar', 'obtener']);
    api.listar.and.returnValue(of([practica]));
    api.obtener.and.returnValue(of(practica));
  });
  afterEach(() => fixture?.destroy());

  it('muestra el listado y enlace al detalle sin consultar otra práctica', async () => {
    await montar();
    expect(api.listar).toHaveBeenCalledTimes(1);
    expect(api.obtener).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(practica.estudiante);
    expect(fixture.nativeElement.textContent).toContain(practica.centro_practica);
    expect(fixture.nativeElement.textContent).toContain('Ver detalle');
  });
  it('consulta solo el identificador de la ruta y muestra detalle y campos nulos', async () => {
    await montar('15');
    expect(api.obtener).toHaveBeenCalledOnceWith('15');
    expect(api.listar).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Detalle de práctica asignada');
    expect(fixture.nativeElement.textContent).toContain(practica.estudiante);
    expect(fixture.nativeElement.textContent).toContain('Sin fecha registrada');
  });
  it('muestra ausencia de asignaciones únicamente tras completar la carga', async () => {
    const respuesta = new Subject<PracticaDocente[]>();
    api.listar.and.returnValue(respuesta);
    await montar();
    expect(fixture.nativeElement.textContent).toContain('Cargando prácticas');
    expect(fixture.nativeElement.textContent).not.toContain('Todavía no tienes');
    respuesta.next([]); respuesta.complete(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Todavía no tienes prácticas asignadas');
    expect(fixture.componentInstance.cargando).toBeFalse();
  });
  for (const status of [403, 404, 500]) {
    it(`presenta error ${status} en detalle sin mostrar datos y permite reintentar`, async () => {
      api.obtener.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      await montar('15');
      expect(fixture.componentInstance.cargando).toBeFalse();
      const esperado = status === 403 ? 'rol DOCENTE activo' : status === 404 ? 'no está asignada' : 'No fue posible cargar';
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(esperado);
      expect(fixture.nativeElement.textContent).not.toContain(practica.estudiante);
      api.obtener.and.returnValue(of(practica));
      const botones: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('ion-button');
      Array.from(botones).find(boton => boton.textContent?.trim() === 'Reintentar')!.click();
      fixture.detectChanges();
      expect(api.obtener).toHaveBeenCalledTimes(2);
      expect(fixture.nativeElement.textContent).toContain(practica.estudiante);
      expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    });
  }
  it('finaliza la carga y muestra error del listado', async () => {
    api.listar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await montar();
    expect(fixture.componentInstance.cargando).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('No fue posible cargar');
    expect(fixture.nativeElement.textContent).not.toContain('Todavía no tienes');
  });
});
