import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
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

  beforeEach(async () => {
    revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', [
      'obtener'
    ]);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [RevisionDetalle],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: '101' })
            }
          }
        },
        { provide: Router, useValue: router },
        { provide: RevisionService, useValue: revisionService }
      ]
    }).compileComponents();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('loads the detail using the id_practica from the route', () => {
    revisionService.obtener.and.returnValue(of(detalle));

    fixture = TestBed.createComponent(RevisionDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(revisionService.obtener).toHaveBeenCalledWith(101);
    expect(component.solicitud?.id_practica).toBe(101);
  });

  it('shows the student associated with the request', () => {
    revisionService.obtener.and.returnValue(of(detalle));

    fixture = TestBed.createComponent(RevisionDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(text).toContain('Antecedentes del estudiante');
    expect(text).toContain('Ana Perez');
    expect(text).toContain('12.345.678-5');
    expect(text).toContain('ana@practicalink.cl');
  });

  it('shows the main antecedents of the request', () => {
    revisionService.obtener.and.returnValue(of(detalle));

    fixture = TestBed.createComponent(RevisionDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(text).toContain('Ingenieria');
    expect(text).toContain('Santiago');
    expect(text).toContain('Centro de prueba');
    expect(text).toContain('76.123.456-7');
    expect(text).toContain('Maria Perez');
    expect(text).toContain('2026-03-02');
    expect(text).toContain('2026-06-30');
    expect(text).toContain('360');
    expect(text).toContain('Desarrollador');
    expect(text).toContain('Practica de caracterizacion');
  });

  it('shows the declared activities for the request', () => {
    revisionService.obtener.and.returnValue(of(detalle));

    fixture = TestBed.createComponent(RevisionDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(text).toContain('Función:');
    expect(text).toContain('Desarrollador');
    expect(text).toContain('Descripción:');
    expect(text).toContain('Practica de caracterizacion');
  });

  it('shows a loading indicator while waiting for the response', () => {
    const respuestaPendiente = new Subject<SolicitudRevisionDetalle>();
    revisionService.obtener.and.returnValue(respuestaPendiente.asObservable());

    fixture = TestBed.createComponent(RevisionDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.cargando).toBeTrue();
    expect(fixture.nativeElement.querySelector('ion-spinner')).not.toBeNull();

    respuestaPendiente.next(detalle);
    respuestaPendiente.complete();
    fixture.detectChanges();

    expect(component.cargando).toBeFalse();
    expect(fixture.nativeElement.querySelector('ion-spinner')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Ana Perez');
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

  it('shows the same error behavior when the request does not exist', () => {
    revisionService.obtener.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 404 }))
    );

    fixture = TestBed.createComponent(RevisionDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.error).toBe('No fue posible cargar la solicitud.');
    expect(fixture.nativeElement.textContent).toContain(
      'No fue posible cargar la solicitud.'
    );
  });
});
