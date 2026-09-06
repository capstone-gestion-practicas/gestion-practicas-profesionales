import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ModalController } from '@ionic/angular';
import { of } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import {
  PracticaDetalleResponse
} from '../../core/models/practica.models';
import { AuthService } from '../../core/services/auth.service';
import { EstudianteService } from '../../core/services/estudiante.service';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { Home } from './home';

describe('Home', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;
  let authStore: AuthStore;
  let authService: jasmine.SpyObj<AuthService>;
  let practicaService: jasmine.SpyObj<PracticaService>;

  const contextoSinPractica: ContextoUsuarioResponse = {
    usuario: {
      id_usuario: 1,
      nombre: 'Usuario',
      apellido: 'Demo',
      correo: 'demo@practicalink.cl'
    },
    roles: ['ESTUDIANTE'],
    perfil: null,
    practica_actual: null
  };

  const contextoConPractica: ContextoUsuarioResponse = {
    usuario: {
      id_usuario: 1,
      nombre: 'Usuario',
      apellido: 'Demo',
      correo: 'demo@practicalink.cl'
    },
    roles: ['ESTUDIANTE'],
    perfil: null,
    practica_actual: {
      id_practica: 101,
      estado: {
        id_estado: 1,
        nombre: 'REGISTRADA',
        es_final: false
      },
      centro_practica: {
        id_centro: 22,
        nombre: 'Centro de prueba'
      },
      fecha_inicio: '2026-03-02',
      fecha_termino: '2026-06-30',
      horas: 360,
      cargo_funcion: 'Desarrollador'
    }
  };

  const practicaDetalleCompleta: PracticaDetalleResponse = {
    id_practica: 101,
    fecha_registro: '2026-09-01T10:30:00',
    estado: {
      id_estado: 1,
      nombre: 'REGISTRADA',
      es_final: false
    },
    centro_practica: {
      id_centro: 22,
      nombre: 'Centro de prueba',
      rut_empresa: '12.345.678-5',
      direccion: 'Av. Siempre Viva 123',
      telefono: '+56 9 1234 5678',
      correo: 'contacto@empresa.cl',
      contacto_nombre: 'Maria Perez',
      contacto_cargo: 'Jefa de practica'
    },
    fecha_inicio: '2026-03-02',
    fecha_termino: '2026-06-30',
    horas: 360,
    cargo_funcion: 'Desarrollador',
    descripcion: 'Practica de caracterizacion'
  };

  const practicaDetalleConNulos: PracticaDetalleResponse = {
    id_practica: 202,
    fecha_registro: '2026-09-01T10:30:00',
    estado: {
      id_estado: 2,
      nombre: 'EN_REVISION',
      es_final: false
    },
    centro_practica: {
      id_centro: 33,
      nombre: 'Centro sin datos extra',
      rut_empresa: null,
      direccion: null,
      telefono: null,
      correo: null,
      contacto_nombre: null,
      contacto_cargo: null
    },
    fecha_inicio: null,
    fecha_termino: null,
    horas: null,
    cargo_funcion: null,
    descripcion: null
  };

  beforeEach(async () => {
    authService = jasmine.createSpyObj<AuthService>('AuthService', ['obtenerContexto']);
    authService.obtenerContexto.and.returnValue(of(contextoSinPractica));

    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'obtenerMiPractica'
    ]);
    practicaService.obtenerMiPractica.and.returnValue(of(practicaDetalleCompleta));

    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        AuthStore,
        { provide: AuthService, useValue: authService },
        { provide: PracticaService, useValue: practicaService },
        {
          provide: EstudianteService,
          useValue: jasmine.createSpyObj<EstudianteService>(
            'EstudianteService',
            ['completarPerfil']
          )
        },
        {
          provide: Router,
          useValue: jasmine.createSpyObj<Router>('Router', ['navigate'])
        },
        {
          provide: ModalController,
          useValue: jasmine.createSpyObj<ModalController>(
            'ModalController',
            ['create']
          )
        }
      ]
    })
    .compileComponents();

    authStore = TestBed.inject(AuthStore);
    authStore.setContexto(contextoSinPractica);
    sessionStorage.setItem('access_token', 'test-token');

    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('greets the user with roles from the context', () => {
    expect(component.saludo()).toBe(
      'Hola, Usuario. Estás logueado como ESTUDIANTE.'
    );
  });

  it('shows the registration module to students without a practice', () => {
    expect(component.esEstudiante()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain(
      'Registro de práctica profesional'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Antecedentes de tu práctica'
    );
    expect(practicaService.obtenerMiPractica).not.toHaveBeenCalled();
  });

  it('loads and shows the full practice detail when the student has one', () => {
    authStore.setContexto(contextoConPractica);
    practicaService.obtenerMiPractica.and.returnValue(of(practicaDetalleCompleta));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');

    expect(practicaService.obtenerMiPractica).toHaveBeenCalled();
    expect(text).toContain('Antecedentes de tu práctica');
    expect(text).toContain('Fecha de registro:');
    expect(text).toContain('2026-09-01T10:30:00');
    expect(text).toContain('Fecha de inicio:');
    expect(text).toContain('2026-03-02');
    expect(text).toContain('Fecha de término:');
    expect(text).toContain('2026-06-30');
    expect(text).toContain('Horas:');
    expect(text).toContain('360');
    expect(text).toContain('Función:');
    expect(text).toContain('Desarrollador');
    expect(text).toContain('Descripción:');
    expect(text).toContain('Practica de caracterizacion');
    expect(text).toContain('Estado:');
    expect(text).toContain('REGISTRADA');
    expect(text).toContain('Centro de práctica:');
    expect(text).toContain('Centro de prueba');
    expect(text).toContain('RUT empresa:');
    expect(text).toContain('12.345.678-5');
    expect(text).toContain('Dirección:');
    expect(text).toContain('Av. Siempre Viva 123');
    expect(text).toContain('Teléfono:');
    expect(text).toContain('+56 9 1234 5678');
    expect(text).toContain('Correo:');
    expect(text).toContain('contacto@empresa.cl');
    expect(text).toContain('Contacto:');
    expect(text).toContain('Maria Perez');
    expect(text).toContain('Cargo de contacto:');
    expect(text).toContain('Jefa de practica');
  });

  it('does not print null values in the practice detail', () => {
    authStore.setContexto(contextoConPractica);
    practicaService.obtenerMiPractica.and.returnValue(of(practicaDetalleConNulos));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).not.toContain('null');
    expect(text).toContain('No informado');
    expect(text).toContain('Centro sin datos extra');
  });

  it('keeps loading the auth context as before', () => {
    authStore.limpiar();
    authService.obtenerContexto.and.returnValue(of(contextoSinPractica));

    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(authService.obtenerContexto).toHaveBeenCalled();
    expect(component.esEstudiante()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain(
      'Registro de práctica profesional'
    );
  });
});
