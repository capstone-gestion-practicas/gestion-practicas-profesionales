import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { SolicitudRevisionResumen } from '../../core/models/revision.models';
import { RevisionService } from '../../core/services/revision.service';
import { Revisiones } from './revisiones';

describe('Revisiones', () => {
  let component: Revisiones;
  let fixture: ComponentFixture<Revisiones>;
  let revisionService: jasmine.SpyObj<RevisionService>;
  let router: jasmine.SpyObj<Router>;

  const solicitudes: SolicitudRevisionResumen[] = [
    {
      id_practica: 101,
      fecha_registro: '2026-09-01T10:30:00',
      estado: 'REGISTRADA',
      estudiante: 'Ana Perez',
      rut_estudiante: '12.345.678-5',
      centro_practica: 'Centro de prueba'
    },
    {
      id_practica: 202,
      fecha_registro: '2026-09-02T09:15:00',
      estado: 'EN_REVISION',
      estudiante: 'Bruno Soto',
      rut_estudiante: '11.222.333-4',
      centro_practica: 'Centro Norte'
    }
  ];

  beforeEach(async () => {
    revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', [
      'listar'
    ]);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [Revisiones],
      providers: [
        { provide: RevisionService, useValue: revisionService },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('renders the list when the service returns requests', () => {
    revisionService.listar.and.returnValue(of(solicitudes));

    fixture = TestBed.createComponent(Revisiones);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(component.solicitudes).toEqual(solicitudes);
    expect(text).toContain('Solicitudes de práctica');
    expect(text).toContain('Ana Perez');
    expect(text).toContain('Bruno Soto');
    expect(text).toContain('REGISTRADA');
    expect(text).toContain('EN_REVISION');
    expect(text).toContain('Centro de prueba');
    expect(text).toContain('Centro Norte');
    expect(text).toContain('Revisar antecedentes');
    expect(fixture.nativeElement.querySelectorAll('ion-card').length).toBe(2);
  });

  it('shows the student associated with each request', () => {
    revisionService.listar.and.returnValue(of(solicitudes));

    fixture = TestBed.createComponent(Revisiones);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(text).toContain('Ana Perez');
    expect(text).toContain('Bruno Soto');
    expect(text).toContain('RUT:');
    expect(text).toContain('12.345.678-5');
    expect(text).toContain('11.222.333-4');
  });

  it('shows the current state for each request', () => {
    revisionService.listar.and.returnValue(of(solicitudes));

    fixture = TestBed.createComponent(Revisiones);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(text).toContain('Estado:');
    expect(text).toContain('REGISTRADA');
    expect(text).toContain('EN_REVISION');
  });

  it('shows an empty state when there are no requests', () => {
    revisionService.listar.and.returnValue(of([]));

    fixture = TestBed.createComponent(Revisiones);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(component.solicitudes).toEqual([]);
    expect(text).toContain('No hay solicitudes pendientes.');
    expect(fixture.nativeElement.querySelectorAll('ion-card').length).toBe(1);
  });

  it('shows an error when loading fails', () => {
    revisionService.listar.and.returnValue(
      throwError(() => new Error('network error'))
    );

    fixture = TestBed.createComponent(Revisiones);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(component.error).toBe('No fue posible cargar las solicitudes.');
    expect(text).toContain('No fue posible cargar las solicitudes.');
  });

  it('shows a loading indicator while waiting for the response', () => {
    const solicitudesPendientes = new Subject<SolicitudRevisionResumen[]>();
    revisionService.listar.and.returnValue(solicitudesPendientes.asObservable());

    fixture = TestBed.createComponent(Revisiones);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.cargando).toBeTrue();
    expect(fixture.nativeElement.querySelector('ion-spinner')).not.toBeNull();

    solicitudesPendientes.next(solicitudes);
    solicitudesPendientes.complete();
    fixture.detectChanges();

    expect(component.cargando).toBeFalse();
    expect(fixture.nativeElement.querySelector('ion-spinner')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Ana Perez');
  });
});
