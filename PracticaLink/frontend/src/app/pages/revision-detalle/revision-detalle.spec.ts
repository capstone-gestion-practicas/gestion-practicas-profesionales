import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { SolicitudRevisionDetalle } from '../../core/models/revision.models';
import { RevisionService } from '../../core/services/revision.service';
import { RevisionDetalle } from './revision-detalle';

describe('RevisionDetalle', () => {
  let component: RevisionDetalle;
  let fixture: ComponentFixture<RevisionDetalle>;
  let revisionService: jasmine.SpyObj<RevisionService>;
  let router: jasmine.SpyObj<Router>;

  const detalle: SolicitudRevisionDetalle = {
    id_practica: 101,
    fecha_registro: '2026-09-01T10:30:00',
    estado: 'REGISTRADA',
    estudiante: 'Ana Perez',
    rut_estudiante: '12.345.678-5',
    correo_estudiante: 'ana@practicalink.cl',
    carrera: 'Ingenieria',
    sede: 'Santiago',
    centro_practica: 'Centro de prueba',
    rut_empresa: '76.123.456-7',
    direccion_empresa: 'Av. Siempre Viva 123',
    correo_empresa: 'contacto@empresa.cl',
    contacto_nombre: 'Maria Perez',
    contacto_cargo: 'Jefa de practica',
    fecha_inicio: '2026-03-02',
    fecha_termino: '2026-06-30',
    horas: 360,
    cargo_funcion: 'Desarrollador',
    descripcion: 'Practica de caracterizacion'
  };

  const config = {
    snapshot: {
      paramMap: convertToParamMap({ id: '101' })
    }
  };

  beforeEach(async () => {
    revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', [
      'obtener',
      'resolver'
    ]);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [RevisionDetalle],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: config.snapshot } },
        { provide: Router, useValue: router },
        { provide: RevisionService, useValue: revisionService }
      ]
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
  });

  function createLoadedComponent(): void {
    revisionService.obtener.and.returnValue(of(detalle));
    fixture = TestBed.createComponent(RevisionDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function openDecision(decision: 'APROBADA' | 'OBSERVADA' | 'RECHAZADA'): void {
    component.abrirDecision(decision);
    fixture.detectChanges();
  }

  it('loads the detail using the selected id_practica', () => {
    createLoadedComponent();

    expect(revisionService.obtener).toHaveBeenCalledWith(101);
    expect(component.solicitud?.id_practica).toBe(101);
  });

  it('renders the resolution actions', () => {
    createLoadedComponent();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(text).toContain('Aprobar');
    expect(text).toContain('Observar');
    expect(text).toContain('Rechazar');
  });

  it('sends APROBADA when approving', () => {
    createLoadedComponent();
    revisionService.resolver.and.returnValue(
      of({
        id_practica: 101,
        estado: 'APROBADA',
        mensaje: 'Solicitud revisada correctamente'
      })
    );

    openDecision('APROBADA');
    component.confirmar();

    expect(revisionService.resolver).toHaveBeenCalledWith(101, 'APROBADA', null);
    expect(router.navigate).toHaveBeenCalledWith(['/revisiones']);
    expect(component.guardando).toBeFalse();
  });

  it('sends OBSERVADA with an observation', () => {
    createLoadedComponent();
    revisionService.resolver.and.returnValue(
      of({
        id_practica: 101,
        estado: 'OBSERVADA',
        mensaje: 'Solicitud revisada correctamente'
      })
    );

    openDecision('OBSERVADA');
    component.observacion = 'Faltan antecedentes';
    component.confirmar();

    expect(revisionService.resolver).toHaveBeenCalledWith(
      101,
      'OBSERVADA',
      'Faltan antecedentes'
    );
    expect(router.navigate).toHaveBeenCalledWith(['/revisiones']);
  });

  it('sends RECHAZADA with an observation', () => {
    createLoadedComponent();
    revisionService.resolver.and.returnValue(
      of({
        id_practica: 101,
        estado: 'RECHAZADA',
        mensaje: 'Solicitud revisada correctamente'
      })
    );

    openDecision('RECHAZADA');
    component.observacion = 'No cumple requisitos';
    component.confirmar();

    expect(revisionService.resolver).toHaveBeenCalledWith(
      101,
      'RECHAZADA',
      'No cumple requisitos'
    );
    expect(router.navigate).toHaveBeenCalledWith(['/revisiones']);
  });

  it('does not continue with OBSERVADA without observation', () => {
    createLoadedComponent();

    openDecision('OBSERVADA');
    component.observacion = '   ';
    component.confirmar();

    expect(component.error).toBe('Debes ingresar una observación.');
    expect(revisionService.resolver).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not continue with RECHAZADA without observation', () => {
    createLoadedComponent();

    openDecision('RECHAZADA');
    component.observacion = '';
    component.confirmar();

    expect(component.error).toBe('Debes ingresar una observación.');
    expect(revisionService.resolver).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows the loading indicator while waiting for the detail', () => {
    const pending = new Subject<SolicitudRevisionDetalle>();
    revisionService.obtener.and.returnValue(pending.asObservable());

    fixture = TestBed.createComponent(RevisionDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.cargando).toBeTrue();
    expect(fixture.nativeElement.querySelector('ion-spinner')).not.toBeNull();

    pending.next(detalle);
    pending.complete();
    fixture.detectChanges();

    expect(component.cargando).toBeFalse();
    expect(fixture.nativeElement.querySelector('ion-spinner')).toBeNull();
  });

  it('shows an error when the consultation fails', () => {
    revisionService.obtener.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500 }))
    );

    fixture = TestBed.createComponent(RevisionDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(component.error).toBe('No fue posible cargar la solicitud.');
    expect(text).toContain('No fue posible cargar la solicitud.');
  });

  it('shows an error when the resolution service fails', () => {
    createLoadedComponent();
    revisionService.resolver.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 500,
            error: { detail: 'No fue posible guardar la decisión.' }
          })
      )
    );

    openDecision('APROBADA');
    component.confirmar();

    expect(component.error).toBe('No fue posible guardar la decisión.');
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
