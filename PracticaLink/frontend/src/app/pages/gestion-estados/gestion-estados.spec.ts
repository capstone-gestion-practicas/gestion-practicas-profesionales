import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { PracticaEstadoResumen } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { GestionEstados } from './gestion-estados';
import { codigosInternosVisibles } from '../../shared/testing/codigos-internos';

describe('GestionEstados (mensajes de lista y navegación de gestor)', () => {
  let fixture: ComponentFixture<GestionEstados>;
  let component: GestionEstados;
  let practicaService: jasmine.SpyObj<PracticaService>;
  let authStore: AuthStore;

  const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Demo', correo: 'gestor@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  const practica = (): PracticaEstadoResumen => ({
    id_practica: 7,
    id_estado: 2,
    estado: 'EN_CURSO',
    fecha_termino: null,
    es_final: false,
    estudiante: 'Ana Soto',
    rut_estudiante: '12.345.678-5',
    centro_practica: 'Centro demostrativo',
    id_gestor: null
  } as unknown as PracticaEstadoResumen);

  const texto = (): string => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');

  function crear(roles: string[], practicas: PracticaEstadoResumen[] | 'error'): void {
    if (practicas === 'error') {
      practicaService.listarPracticasParaGestion.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
    } else {
      practicaService.listarPracticasParaGestion.and.returnValue(of(practicas));
    }
    authStore.setContexto(contextoCon(roles));
    fixture = TestBed.createComponent(GestionEstados);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'listarPracticasParaGestion',
      'listarEstados',
      'listarGestores'
    ]);
    practicaService.listarEstados.and.returnValue(of([]));
    practicaService.listarGestores.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [GestionEstados],
      providers: [
        AuthStore,
        { provide: PracticaService, useValue: practicaService },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } }
      ]
    }).compileComponents();

    authStore = TestBed.inject(AuthStore);
  });

  afterEach(() => fixture?.destroy());

  it('distingue un gestor sin prácticas asignadas de un filtro sin coincidencias', () => {
    crear(['GESTOR'], []);
    expect(texto()).toContain('Aún no tienes prácticas asignadas');
    expect(texto()).not.toContain('coincidan');
  });

  it('muestra el vacío por filtro cuando hay prácticas pero ninguna coincide', () => {
    crear(['GESTOR'], [practica()]);
    component.busqueda = 'texto-inexistente';
    fixture.detectChanges();
    expect(texto()).toContain('No hay prácticas que coincidan con la búsqueda o el filtro aplicado.');
    expect(texto()).not.toContain('Aún no tienes prácticas asignadas');
  });

  it('muestra error de carga y no un listado vacío', () => {
    crear(['GESTOR'], 'error');
    expect(texto()).toContain('No fue posible cargar las prácticas y los estados disponibles.');
    expect(texto()).not.toContain('Aún no tienes prácticas asignadas');
    expect(texto()).not.toContain('coincidan');
  });

  it('el administrador recibe el mensaje de ausencia total de prácticas', () => {
    crear(['ADMINISTRADOR'], []);
    expect(texto()).toContain('No hay prácticas registradas.');
  });

  it('el gestor dedicado no muestra el botón Volver, que sustituye la cabecera', () => {
    crear(['GESTOR'], [practica()]);
    expect(texto()).not.toContain('Volver');
  });

  it('el administrador conserva el botón Volver', () => {
    crear(['ADMINISTRADOR'], [practica()]);
    expect(texto()).toContain('Volver');
  });

  it('no muestra códigos internos y usa la etiqueta del ciclo de las prácticas', () => {
    crear(['GESTOR'], [practica()]);
    expect(codigosInternosVisibles(fixture.nativeElement)).toEqual([]);
    expect(fixture.nativeElement.querySelector('.module-label')?.textContent?.trim()).toBe('CICLO DE LAS PRÁCTICAS');
  });
});
