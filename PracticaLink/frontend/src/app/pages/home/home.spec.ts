import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ModalController } from '@ionic/angular';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { HistorialEstadoPractica, PracticaDetalleResponse } from '../../core/models/practica.models';
import { AuthService } from '../../core/services/auth.service';
import { EstudianteService } from '../../core/services/estudiante.service';
import { NotificacionService } from '../../features/notificaciones/services/notificacion.service';
import { PracticaService } from '../../core/services/practica.service';
import { RevisionService } from '../../core/services/revision.service';
import { UsuarioService } from '../../core/services/usuario.service';
import { AuthStore } from '../../core/store/auth.store';
import { PracticaForm } from '../practica-form/practica-form';
import { Home } from './home';

describe('Home', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;
  let authStore: AuthStore;

  const contexto: ContextoUsuarioResponse = {
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

  beforeEach(async () => {
    const authService = jasmine.createSpyObj<AuthService>(
      'AuthService',
      ['obtenerContexto']
    );
    authService.obtenerContexto.and.returnValue(of(contexto));
    const practicaService = jasmine.createSpyObj<PracticaService>(
      'PracticaService',
      [
        'obtenerMiPractica',
        'obtenerHistorialEstados',
        'listarEstados',
        'listarPracticasParaGestion',
        'listarEstudiantesSinPractica',
        'enviarRecordatorioEstudiante',
        'responderObservacion'
      ]
    );
    practicaService.listarEstudiantesSinPractica.and.returnValue(of([]));
    const usuarioService = jasmine.createSpyObj<UsuarioService>('UsuarioService', ['listar']);
    usuarioService.listar.and.returnValue(of([]));
    const revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', ['listar']);
    revisionService.listar.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        AuthStore,
        { provide: AuthService, useValue: authService },
        {
          provide: EstudianteService,
          useValue: jasmine.createSpyObj<EstudianteService>(
            'EstudianteService',
            ['completarPerfil']
          )
        },
        {
          provide: PracticaService,
          useValue: practicaService
        },
        {
          provide: NotificacionService,
          useValue: { noLeidas: signal(0) }
        },
        {
          provide: UsuarioService,
          useValue: usuarioService
        },
        {
          provide: RevisionService,
          useValue: revisionService
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
    authStore.setContexto(contexto);
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

  it('shows the registration module to students', () => {
    expect(component.esEstudiante()).toBeTrue();
    expect(
      fixture.nativeElement.textContent
    ).toContain('Completa tu perfil');
  });

  it('shows a dedicated workflow dashboard to gestores', () => {
    fixture.destroy();
    authStore.setContexto({ ...contexto, roles: ['GESTOR'] });
    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Espacio de gestión');
    expect(text).toContain('Revisar solicitudes');
    expect(text).not.toContain('Tu espacio de práctica');
  });

  it('lets users with both roles switch between their workspaces', () => {
    fixture.destroy();
    authStore.setContexto({ ...contexto, roles: ['ESTUDIANTE', 'GESTOR'] });
    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const switchButton = fixture.nativeElement.querySelector('.workspace-switch') as HTMLButtonElement;
    expect(fixture.nativeElement.textContent).toContain('Espacio de gestión');
    expect(switchButton.textContent).toContain('Mi práctica');

    switchButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Tu espacio de práctica');

    const returnButton = fixture.nativeElement.querySelector('.workspace-switch') as HTMLButtonElement;
    returnButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Espacio de gestión');
  });

  it('lets a student administrator switch from the admin dashboard to the student space', () => {
    const practicaService = TestBed.inject(PracticaService) as jasmine.SpyObj<PracticaService>;
    practicaService.listarEstados.and.returnValue(of([]));
    practicaService.listarPracticasParaGestion.and.returnValue(of([]));

    fixture.destroy();
    authStore.setContexto({ ...contexto, roles: ['ESTUDIANTE', 'ADMINISTRADOR'] });
    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Dashboard');
    const switchButton = fixture.nativeElement.querySelector('.workspace-switch') as HTMLButtonElement;
    expect(switchButton.textContent).toContain('Mi práctica');
    switchButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Tu espacio de práctica');

    const returnButton = fixture.nativeElement.querySelector('.workspace-switch') as HTMLButtonElement;
    returnButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Dashboard');
  });

  it('navigates gestores to the dedicated notification sender', () => {
    const router = TestBed.inject(Router);

    component.enviarNotificaciones();

    expect(router.navigate).toHaveBeenCalledWith(['/envio-notificaciones']);
  });

  describe('estudiante: estado, próxima acción y respuesta a observaciones', () => {
    const contextoConPerfil: ContextoUsuarioResponse = {
      ...contexto,
      perfil: { id_estudiante: 7, rut: '12345678-5', carrera: 'Ingeniería', sede: 'Central' }
    };

    const contextoConPractica: ContextoUsuarioResponse = {
      ...contextoConPerfil,
      practica_actual: {
        id_practica: 15,
        estado: { id_estado: 2, nombre: 'REGISTRADA', es_final: false },
        centro_practica: { id_centro: 9, nombre: 'Centro sintético' },
        fecha_inicio: null,
        fecha_termino: null,
        horas: null,
        horas_semanales: null,
        cargo_funcion: null
      }
    };

    const practica = (nombre: string, esFinal = false): PracticaDetalleResponse => ({
      id_practica: 15,
      fecha_registro: '2026-03-01T12:00:00Z',
      estado: { id_estado: 2, nombre, es_final: esFinal },
      centro_practica: {
        id_centro: 9,
        nombre: 'Centro sintético',
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
    });

    const MENSAJE_DESCONOCIDO =
      'No pudimos identificar el estado actual de tu práctica. Puedes consultar el historial para obtener más información.';
    const MENSAJE_404 = 'No pudimos cargar los antecedentes de tu práctica. Intenta nuevamente más tarde.';

    let practicaService: jasmine.SpyObj<PracticaService>;
    let authService: jasmine.SpyObj<AuthService>;

    beforeEach(() => {
      practicaService = TestBed.inject(PracticaService) as jasmine.SpyObj<PracticaService>;
      authService = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
      practicaService.obtenerHistorialEstados.and.returnValue(of([]));
      practicaService.obtenerMiPractica.and.returnValue(of(practica('REGISTRADA')));
      practicaService.responderObservacion.and.returnValue(
        of({ id_practica: 15, id_estado: 2, estado: 'OBSERVADA', mensaje: 'Respuesta registrada.' })
      );
      authService.obtenerContexto.and.returnValue(of(contextoConPractica));
    });

    function crearVista(ctx: ContextoUsuarioResponse): void {
      fixture.destroy();
      authStore.setContexto(ctx);
      fixture = TestBed.createComponent(Home);
      component = fixture.componentInstance;
      fixture.detectChanges();
      fixture.detectChanges();
    }

    function texto(): string {
      return fixture.nativeElement.textContent;
    }

    it('sin perfil ofrece completar el perfil y no muestra estado', () => {
      crearVista(contexto);
      expect(texto()).toContain('Completar mi perfil');
      expect(fixture.nativeElement.querySelector('.student-practice-status')).toBeNull();
    });

    it('con perfil y sin práctica ofrece comenzar el registro', () => {
      crearVista(contextoConPerfil);
      expect(texto()).toContain('Registrar práctica');
      expect(practicaService.obtenerMiPractica).not.toHaveBeenCalled();
    });

    it('abre el formulario actual de registro de práctica como modal', async () => {
      const modalController = TestBed.inject(ModalController) as jasmine.SpyObj<ModalController>;
      const present = jasmine.createSpy('present').and.returnValue(Promise.resolve());
      const modal = { present } as unknown as Awaited<ReturnType<ModalController['create']>>;
      modalController.create.and.returnValue(Promise.resolve(modal));

      await component.registrarPractica();

      expect(modalController.create).toHaveBeenCalledWith(jasmine.objectContaining({
        component: PracticaForm,
        cssClass: 'practice-registration-modal',
        backdropDismiss: false
      }));
      expect(present).toHaveBeenCalled();
    });

    it('documenta que /me prevalece para detalle e historial cuando su ID difiere del contexto', () => {
      const detalleDeOtraPractica = { ...practica('APROBADA'), id_practica: 21 };
      practicaService.obtenerMiPractica.and.returnValue(of(detalleDeOtraPractica));

      crearVista(contextoConPractica);

      expect(contextoConPractica.practica_actual?.id_practica).toBe(15);
      expect(component.practicaDetalle?.id_practica).toBe(21);
      expect(practicaService.obtenerHistorialEstados).toHaveBeenCalledWith(21);
    });

    it('abre y cancela el modal actual para completar perfil', () => {
      crearVista(contexto);

      component.completarPerfil();
      expect(component.modalPerfilAbierto).toBeTrue();
      component.cerrarModalPerfil();
      expect(component.modalPerfilAbierto).toBeFalse();
    });

    it('guarda el perfil y refresca el contexto autenticado', () => {
      const contextoConPerfil = {
        ...contexto,
        perfil: { id_estudiante: 7, rut: '12345678-5', carrera: 'Ingeniería', sede: 'Central' }
      };
      const estudianteService = TestBed.inject(EstudianteService) as jasmine.SpyObj<EstudianteService>;
      estudianteService.completarPerfil.and.returnValue(of({
        id_estudiante: 7,
        mensaje: 'Perfil completado.'
      }));
      authService.obtenerContexto.and.returnValue(of(contextoConPerfil));

      component.completarPerfil();
      component.rutPerfil = '12345678-5';
      component.carreraPerfil = 'Ingeniería';
      component.sedePerfil = 'Central';
      component.guardarPerfil();

      expect(estudianteService.completarPerfil).toHaveBeenCalledWith(jasmine.objectContaining({
        rut: '12.345.678-5',
        carrera: 'Ingeniería',
        sede: 'Central'
      }));
      expect(authStore.contexto()?.perfil?.id_estudiante).toBe(7);
      expect(component.modalPerfilAbierto).toBeFalse();
    });

    it('muestra el estado con app-estado-badge y su mensaje informativo', () => {
      practicaService.obtenerMiPractica.and.returnValue(of(practica('EN_REVISION')));
      crearVista(contextoConPractica);
      expect(fixture.nativeElement.querySelector('app-estado-badge')).not.toBeNull();
      expect(texto()).toContain('En revisión');
      expect(texto()).toContain('Tu práctica está siendo revisada.');
    });

    it('asigna un mensaje informativo a cada estado conocido', () => {
      const esperados: Record<string, string> = {
        REGISTRADA: 'Tu práctica fue registrada.',
        EN_REVISION: 'Tu práctica está siendo revisada.',
        OBSERVADA: 'Tu práctica tiene observaciones. Responde para que vuelva a revisión.',
        APROBADA: 'Tu práctica fue aprobada.',
        EN_CURSO: 'Tu práctica está en curso.',
        FINALIZADA: 'Tu práctica finalizó.',
        RECHAZADA: 'Tu práctica fue rechazada. Puedes consultar el historial para revisar las observaciones disponibles.'
      };
      for (const [estado, mensaje] of Object.entries(esperados)) {
        expect(component.mensajeEstadoPractica(estado)).toBe(mensaje);
      }
    });

    it('usa presentación alternativa para un estado desconocido', () => {
      practicaService.obtenerMiPractica.and.returnValue(of(practica('ESTADO_NUEVO')));
      crearVista(contextoConPractica);
      expect(component.mensajeEstadoPractica('ESTADO_NUEVO')).toBe(MENSAJE_DESCONOCIDO);
      expect(texto()).toContain('ESTADO_NUEVO');
      expect(texto()).toContain(MENSAJE_DESCONOCIDO);
    });

    it('en OBSERVADA muestra el formulario de respuesta', () => {
      practicaService.obtenerMiPractica.and.returnValue(of(practica('OBSERVADA')));
      crearVista(contextoConPractica);
      expect(fixture.nativeElement.querySelector('ion-textarea')).not.toBeNull();
      expect(texto()).toContain('Enviar respuesta y volver a revisión');
    });

    it('respuesta exitosa limpia el texto y recarga práctica y contexto', () => {
      practicaService.obtenerMiPractica.and.returnValues(
        of(practica('OBSERVADA')),
        of(practica('EN_REVISION'))
      );
      crearVista(contextoConPractica);

      component.respuestaObservacion = 'Corregí el informe';
      component.responderObservacionEstudiante();

      expect(practicaService.responderObservacion).toHaveBeenCalledWith(15, 'Corregí el informe');
      expect(component.respuestaObservacion).toBe('');
      expect(component.mensajeRespuestaObservacion).toBe('Respuesta registrada.');
      expect(component.errorRespuestaObservacion).toBe('');
      expect(component.errorActualizacionPractica).toBe('');
      expect(component.practicaDetalle?.estado.nombre).toBe('EN_REVISION');
      expect(authService.obtenerContexto).toHaveBeenCalled();
    });

    it('envío fallido conserva el texto y muestra el error de envío', () => {
      practicaService.obtenerMiPractica.and.returnValue(of(practica('OBSERVADA')));
      crearVista(contextoConPractica);
      practicaService.responderObservacion.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'La respuesta es inválida' } }))
      );

      component.respuestaObservacion = 'Mi respuesta';
      component.responderObservacionEstudiante();

      expect(component.respuestaObservacion).toBe('Mi respuesta');
      expect(component.errorRespuestaObservacion).toBe('La respuesta es inválida');
      expect(component.errorActualizacionPractica).toBe('');
      expect(practicaService.obtenerMiPractica).toHaveBeenCalledTimes(1);
    });

    it('envío aceptado con recarga fallida muestra error de actualización, no de envío', () => {
      practicaService.obtenerMiPractica.and.returnValues(
        of(practica('OBSERVADA')),
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      crearVista(contextoConPractica);

      component.respuestaObservacion = 'Mi respuesta';
      component.responderObservacionEstudiante();
      fixture.detectChanges();

      expect(component.respuestaObservacion).toBe('');
      expect(component.mensajeRespuestaObservacion).toBe('Respuesta registrada.');
      expect(component.errorRespuestaObservacion).toBe('');
      expect(component.errorActualizacionPractica).toContain('no pudimos actualizar');
      expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent)
        .toContain('no pudimos actualizar');
    });

    it('error de consulta distinto de 404 muestra el mensaje genérico', () => {
      practicaService.obtenerMiPractica.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      crearVista(contextoConPractica);
      expect(component.errorPractica).toBe('No fue posible cargar los antecedentes de tu práctica.');
      expect(texto()).toContain('No fue posible cargar los antecedentes de tu práctica.');
    });

    it('404 con práctica en el contexto muestra error y no un modal vacío', () => {
      practicaService.obtenerMiPractica.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 404 }))
      );
      crearVista(contextoConPractica);
      expect(component.practicaDetalle).toBeNull();
      expect(component.errorPractica).toBe(MENSAJE_404);
      expect(texto()).toContain(MENSAJE_404);
    });

    it('muestra estado de carga y error del historial', () => {
      practicaService.obtenerHistorialEstados.and.returnValue(new Subject<HistorialEstadoPractica[]>().asObservable());
      crearVista(contextoConPractica);
      expect(texto()).toContain('Cargando historial...');

      practicaService.obtenerHistorialEstados.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      crearVista(contextoConPractica);
      expect(texto()).toContain('No fue posible cargar el historial de estados.');
    });

    it('abre y cierra el modal de antecedentes', () => {
      crearVista(contextoConPractica);
      component.abrirAntecedentesPractica();
      expect(component.modalAntecedentesAbierto).toBeTrue();
      component.cerrarAntecedentes();
      expect(component.modalAntecedentesAbierto).toBeFalse();
    });

    it('cierre de sesión limpia el token y el contexto, y navega a login', () => {
      crearVista(contextoConPractica);
      const router = TestBed.inject(Router);

      component.cerrarSesion();

      expect(sessionStorage.getItem('access_token')).toBeNull();
      expect(authStore.contexto()).toBeNull();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('no muestra el chip fijo "Cuenta activa"', () => {
      crearVista(contextoConPractica);
      expect(texto()).not.toContain('Cuenta activa');
    });

    it('gestor no recibe el encabezado de estudiante', () => {
      crearVista({ ...contexto, roles: ['GESTOR'] });
      expect(fixture.nativeElement.querySelector('.student-brand-header')).toBeNull();
      expect(texto()).toContain('Espacio de gestión');
    });

    function botonPorTexto(texto: string): HTMLElement & { disabled?: boolean } | undefined {
      return Array.from(fixture.nativeElement.querySelectorAll('button, ion-button') as NodeListOf<HTMLElement>)
        .find(boton => boton.textContent?.trim().includes(texto));
    }

    it('estudiante usa navegación propia y no muestra el encabezado compartido', () => {
      crearVista(contextoConPerfil);
      expect(fixture.nativeElement.querySelector('.brand-header')).toBeNull();
      const nav = fixture.nativeElement.querySelector('nav[aria-label="Navegación del estudiante"]');
      expect(nav).not.toBeNull();
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain('Inicio');
      expect(fixture.nativeElement.querySelector('nav[aria-label="Navegación móvil"]')).not.toBeNull();
    });

    it('Mi práctica queda deshabilitada sin práctica registrada', () => {
      crearVista(contextoConPerfil);
      expect(botonPorTexto('Mi práctica')?.disabled).toBeTrue();
    });

    it('Mi práctica abre los antecedentes cuando existe práctica', () => {
      crearVista(contextoConPractica);
      expect(botonPorTexto('Mi práctica')?.disabled).toBeFalse();
      botonPorTexto('Mi práctica')?.click();
      expect(component.modalAntecedentesAbierto).toBeTrue();
    });

    it('Documentos y Soporte no aparecen en la navegación', () => {
      crearVista(contextoConPractica);
      expect(botonPorTexto('Documentos')).toBeUndefined();
      expect(botonPorTexto('Soporte')).toBeUndefined();
    });

    it('cierre de sesión desde la navegación lateral limpia la sesión', () => {
      crearVista(contextoConPractica);
      const router = TestBed.inject(Router);
      botonPorTexto('Cerrar sesión')?.click();
      expect(sessionStorage.getItem('access_token')).toBeNull();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('el contador de notificaciones refleja el servicio', () => {
      const notificaciones = TestBed.inject(NotificacionService) as unknown as { noLeidas: WritableSignal<number> };
      notificaciones.noLeidas.set(2);
      crearVista(contextoConPractica);
      const campana = fixture.nativeElement.querySelector('.student-bell') as HTMLButtonElement;
      expect(campana.getAttribute('aria-label')).toContain('2 sin leer');
      expect(fixture.nativeElement.querySelector('.student-bell__count')?.textContent).toContain('2');
      notificaciones.noLeidas.set(0);
    });

    it('gestor conserva el encabezado compartido', () => {
      crearVista({ ...contexto, roles: ['GESTOR'] });
      expect(fixture.nativeElement.querySelector('.brand-header')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('nav[aria-label="Navegación del estudiante"]')).toBeNull();
    });

    it('administrador sin panel de estudiante conserva el dashboard y el encabezado compartido', () => {
      const practicaService = TestBed.inject(PracticaService) as jasmine.SpyObj<PracticaService>;
      practicaService.listarEstados.and.returnValue(of([]));
      practicaService.listarPracticasParaGestion.and.returnValue(of([]));
      crearVista({ ...contexto, roles: ['ADMINISTRADOR'] });
      expect(fixture.nativeElement.querySelector('.brand-header')).not.toBeNull();
      expect(texto()).toContain('Dashboard');
      expect(fixture.nativeElement.querySelector('nav[aria-label="Navegación del estudiante"]')).toBeNull();
    });

    it('Siguiente paso indica responder la observación cuando la práctica está OBSERVADA', () => {
      practicaService.obtenerMiPractica.and.returnValue(of(practica('OBSERVADA')));
      crearVista(contextoConPractica);
      expect(texto()).toContain('Responder observación');
      expect(texto()).not.toContain('Tu práctica registrada');
    });

    it('la vista de estudiante no muestra el cierre de sesión global', () => {
      crearVista(contextoConPractica);
      expect(fixture.nativeElement.querySelector('.secondary-action')).toBeNull();
    });

    it('gestor conserva el cierre de sesión global', () => {
      crearVista({ ...contexto, roles: ['GESTOR'] });
      expect(fixture.nativeElement.querySelector('.secondary-action')).not.toBeNull();
    });

    it('sin tarea pendiente muestra la línea discreta de acciones', () => {
      crearVista(contextoConPractica);
      expect(texto()).toContain('No tienes acciones pendientes por ahora.');
    });

    it('un estado desconocido no muestra la línea de acciones', () => {
      practicaService.obtenerMiPractica.and.returnValue(of(practica('ESTADO_NUEVO')));
      crearVista(contextoConPractica);
      expect(texto()).not.toContain('No tienes acciones pendientes por ahora.');
    });

    it('un error de consulta no muestra la línea de acciones', () => {
      practicaService.obtenerMiPractica.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      crearVista(contextoConPractica);
      expect(texto()).not.toContain('No tienes acciones pendientes por ahora.');
    });

    it('OBSERVADA muestra la última observación del historial sin desplegarlo', () => {
      practicaService.obtenerMiPractica.and.returnValue(of(practica('OBSERVADA')));
      practicaService.obtenerHistorialEstados.and.returnValue(of([
        { id_historial: 1, id_practica: 15, id_estado: 3, estado: 'OBSERVADA', es_final: false, id_usuario: 2, usuario: 'Gestor', fecha_cambio: '2026-09-22T12:51:00Z', observacion: 'Falta el anexo de horas' }
      ]));
      crearVista(contextoConPractica);
      expect(texto()).toContain('Falta el anexo de horas');
      expect(fixture.nativeElement.querySelector('details')?.open).toBeFalse();
    });

    it('OBSERVADA sin observación registrada muestra un mensaje propio', () => {
      practicaService.obtenerMiPractica.and.returnValue(of(practica('OBSERVADA')));
      practicaService.obtenerHistorialEstados.and.returnValue(of([]));
      crearVista(contextoConPractica);
      expect(texto()).toContain('No hay una observación registrada en el historial.');
    });

    it('RECHAZADA ofrece acceso al historial que lo abre', () => {
      practicaService.obtenerMiPractica.and.returnValue(of(practica('RECHAZADA', true)));
      crearVista(contextoConPractica);
      const boton = botonPorTexto('Ver historial de estados');
      expect(boton).toBeDefined();
      boton?.click();
      expect(component.historialAbierto).toBeTrue();
    });

    it('el historial está plegado por defecto y conserva todos los eventos', () => {
      practicaService.obtenerHistorialEstados.and.returnValue(of([
        { id_historial: 1, id_practica: 15, id_estado: 2, estado: 'REGISTRADA', es_final: false, id_usuario: 2, usuario: 'Estudiante', fecha_cambio: '2026-09-06T22:49:00Z', observacion: null },
        { id_historial: 2, id_practica: 15, id_estado: 3, estado: 'OBSERVADA', es_final: false, id_usuario: 2, usuario: 'Gestor', fecha_cambio: '2026-09-22T12:51:00Z', observacion: 'Revisar' }
      ]));
      crearVista(contextoConPractica);
      const detalles = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
      expect(detalles.open).toBeFalse();
      expect(detalles.querySelectorAll('li').length).toBe(2);
    });

    it('no existe tarjeta independiente de notificaciones', () => {
      crearVista(contextoConPractica);
      expect(texto()).not.toContain('Ver notificaciones');
    });

    it('la topbar del estudiante no muestra el nombre y conserva el avatar accesible', () => {
      crearVista(contextoConPractica);
      expect(fixture.nativeElement.querySelector('.student-account .account-name')).toBeNull();
      const avatar = fixture.nativeElement.querySelector('.student-account .account-avatar') as HTMLElement;
      expect(avatar.getAttribute('aria-label')).toBe('Cuenta de Usuario');
    });

    it('sin práctica no muestra el estado inicial fijo', () => {
      crearVista(contextoConPerfil);
      expect(texto()).not.toContain('Estado inicial');
    });

    it('RECHAZADA no presenta la práctica como registrada en Siguiente paso', () => {
      practicaService.obtenerMiPractica.and.returnValue(of(practica('RECHAZADA', true)));
      crearVista(contextoConPractica);
      expect(texto()).not.toContain('Tu práctica registrada');
    });
  });
});
