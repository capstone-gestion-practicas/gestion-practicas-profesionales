import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ModalController } from '@ionic/angular';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { esEspacioGestorDedicado } from '../../../core/navigation/espacio-gestor';
import { AuthService } from '../../../core/services/auth.service';
import { PracticaService } from '../../../core/services/practica.service';
import { RevisionService } from '../../../core/services/revision.service';
import { UsuarioService } from '../../../core/services/usuario.service';
import { SesionService } from '../../../core/session/sesion.service';
import { AuthStore } from '../../../core/store/auth.store';
import { Home } from '../../../pages/home/home';
import { NotificacionService } from '../../notificaciones/services/notificacion.service';
import { GestorLayout } from './gestor-layout';

/**
 * Etapa 0 · caracterización de cuentas con GESTOR y ADMINISTRADOR simultáneos.
 * El espacio efectivo depende de los roles y de sessionStorage['practicalink-workspace'],
 * que fija la pantalla /espacios. Se documentan las combinaciones actuales sin renderizar
 * plantillas: solo se evalúan las señales calculadas de cada componente.
 */
const CLAVE_ESPACIO = 'practicalink-workspace';

const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
  usuario: { id_usuario: 1, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.test' },
  roles, perfil: null, practica_actual: null
});

type Espacio = 'GESTOR' | 'ADMINISTRADOR' | null;

interface Caso {
  roles: string[];
  espacio: Espacio;
  dedicado: boolean;
  cabecera: boolean;
  homeGestor: boolean;
  esAdministrador: boolean;
  puedeRevisar: boolean;
}

/** Comportamiento vigente; cualquier cambio en la etapa 1 debe actualizar esta tabla de forma explícita. */
const CASOS: Caso[] = [
  { roles: ['GESTOR'], espacio: null, dedicado: true, cabecera: true, homeGestor: true, esAdministrador: false, puedeRevisar: true },
  { roles: ['ADMINISTRADOR'], espacio: null, dedicado: false, cabecera: false, homeGestor: false, esAdministrador: true, puedeRevisar: false },
  { roles: ['GESTOR', 'ADMINISTRADOR'], espacio: null, dedicado: false, cabecera: false, homeGestor: false, esAdministrador: true, puedeRevisar: true },
  { roles: ['GESTOR', 'ADMINISTRADOR'], espacio: 'GESTOR', dedicado: false, cabecera: true, homeGestor: true, esAdministrador: false, puedeRevisar: true },
  { roles: ['GESTOR', 'ADMINISTRADOR'], espacio: 'ADMINISTRADOR', dedicado: false, cabecera: false, homeGestor: false, esAdministrador: true, puedeRevisar: false },
  { roles: ['ADMINISTRADOR'], espacio: 'GESTOR', dedicado: false, cabecera: false, homeGestor: false, esAdministrador: true, puedeRevisar: false }
];

const describir = (caso: Caso): string => `${caso.roles.join('+')} · espacio ${caso.espacio ?? 'sin elegir'}`;

describe('Cuentas GESTOR + ADMINISTRADOR · espacio efectivo (etapa 0)', () => {
  let authStore: AuthStore;

  beforeEach(async () => {
    sessionStorage.removeItem(CLAVE_ESPACIO);
    await TestBed.configureTestingModule({
      providers: [
        AuthStore,
        { provide: AuthService, useValue: jasmine.createSpyObj('AuthService', ['obtenerContexto']) },
        { provide: PracticaService, useValue: jasmine.createSpyObj('PracticaService', ['listarEstados']) },
        { provide: UsuarioService, useValue: jasmine.createSpyObj('UsuarioService', ['listar']) },
        { provide: RevisionService, useValue: jasmine.createSpyObj('RevisionService', ['listar']) },
        { provide: SesionService, useValue: jasmine.createSpyObj('SesionService', ['cerrar']) },
        { provide: ModalController, useValue: jasmine.createSpyObj('ModalController', ['create']) },
        { provide: NotificacionService, useValue: { noLeidas: () => 0 } },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) }
      ]
    }).compileComponents();
    authStore = TestBed.inject(AuthStore);
  });

  afterEach(() => sessionStorage.removeItem(CLAVE_ESPACIO));

  function preparar(caso: Caso): void {
    authStore.setContexto(contextoCon(caso.roles));
    if (caso.espacio) {
      sessionStorage.setItem(CLAVE_ESPACIO, caso.espacio);
    } else {
      sessionStorage.removeItem(CLAVE_ESPACIO);
    }
  }

  for (const caso of CASOS) {
    it(`${describir(caso)}: espacio dedicado y cabecera del gestor`, () => {
      preparar(caso);
      expect(esEspacioGestorDedicado(authStore.obtenerContextoActual())).toBe(caso.dedicado);
      // Sin detectChanges: no se instancia la cabecera ni se consultan servicios.
      const layout = TestBed.createComponent(GestorLayout);
      expect(layout.componentInstance['mostrarCabecera']()).toBe(caso.cabecera);
      layout.destroy();
    });

    it(`${describir(caso)}: señales de Home`, () => {
      preparar(caso);
      const home = TestBed.createComponent(Home);
      const componente = home.componentInstance;
      expect(componente.espacioGestorDedicado()).withContext('espacioGestorDedicado').toBe(caso.homeGestor);
      expect(componente.esAdministrador()).withContext('esAdministrador').toBe(caso.esAdministrador);
      expect(componente.puedeRevisarPracticas()).withContext('puedeRevisarPracticas').toBe(caso.puedeRevisar);
      expect(componente.tieneRolGestor()).withContext('tieneRolGestor').toBe(caso.roles.includes('GESTOR'));
      home.destroy();
    });
  }
});
