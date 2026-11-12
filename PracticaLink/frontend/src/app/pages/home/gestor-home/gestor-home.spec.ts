import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Subject, of, throwError } from 'rxjs';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { EstudianteSinPractica, IncidenciaPractica, RecordatorioEstudianteResponse } from '../../../core/models/practica.models';
import { SolicitudRevisionResumen } from '../../../core/models/revision.models';
import { PracticaService } from '../../../core/services/practica.service';
import { RevisionService } from '../../../core/services/revision.service';
import { AuthStore } from '../../../core/store/auth.store';
import { NotificacionService } from '../../../features/notificaciones/services/notificacion.service';
import { GestorHome } from './gestor-home';
import { RecordatoriosEstudiantes } from '../../../features/gestor/recordatorios/recordatorios-estudiantes';

const hace = (dias: number): string => new Date(Date.now() - dias * 86_400_000).toISOString();

function solicitud(idPractica: number, estado: string, dias: number, estudiante: string): SolicitudRevisionResumen {
  return {
    id_practica: idPractica,
    fecha_registro: hace(dias),
    estado,
    estudiante,
    rut_estudiante: '00.000.000-0',
    centro_practica: 'Centro demostrativo'
  };
}

function incidencia(idIncidencia: number, estado: string, prioridad: string, dias: number): IncidenciaPractica {
  return {
    id_incidencia: idIncidencia,
    id_practica: idIncidencia,
    id_usuario: 1,
    usuario: 'Gestor de prueba',
    fecha: hace(dias),
    descripcion: `Incidencia ${idIncidencia}`,
    prioridad,
    estado,
    fecha_resolucion: null,
    alerta: false,
    estudiante: 'Estudiante de prueba',
    correo_estudiante: null
  } as unknown as IncidenciaPractica;
}

function estudiante(idUsuario: number, nombre: string, perfil: boolean, enviadoHoy: boolean): EstudianteSinPractica {
  return {
    id_usuario: idUsuario,
    nombre,
    apellido: 'Prueba',
    tiene_perfil: perfil,
    tiene_practica: false,
    recordatorio_enviado_hoy: enviadoHoy
  };
}

const respuestaOk = (idUsuario: number): RecordatorioEstudianteResponse => ({
  id_usuario: idUsuario,
  mensaje: 'Recordatorio enviado.',
  correo_enviado: true,
  recordatorio_enviado_hoy: true
});

/** Router simulado con eventos de navegación y URL inicial, para que la cabecera pueda marcar la sección activa. */
function routerSimulado(): Router {
  return Object.assign(jasmine.createSpyObj<Router>('Router', ['navigate']), {
    events: new Subject<Event>(),
    url: '/home'
  });
}

describe('GestorHome', () => {
  let fixture: ComponentFixture<GestorHome>;
  let component: GestorHome;
  let authStore: AuthStore;
  let router: Router;
  let navController: jasmine.SpyObj<NavController>;
  let revisionService: jasmine.SpyObj<RevisionService>;
  let practicaService: jasmine.SpyObj<PracticaService>;

  const contextoCon = (roles: string[], nombre = 'Gestor'): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 1, nombre, apellido: 'Demo', correo: 'gestor@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  const texto = (): string => fixture.nativeElement.textContent as string;

  const boton = (etiqueta: string): HTMLButtonElement | undefined =>
    (Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>))
      .find(elemento => elemento.textContent?.trim().includes(etiqueta));

  const indicador = (posicion: number): HTMLElement =>
    fixture.nativeElement.querySelectorAll('.gh-indicador')[posicion] as HTMLElement;

  const crear = (roles: string[] = ['GESTOR']): void => {
    fixture?.destroy();
    authStore.setContexto(contextoCon(roles));
    fixture = TestBed.createComponent(GestorHome);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  const casillasEstudiantes = (): HTMLInputElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.gh-estudiante input') as NodeListOf<HTMLInputElement>);

  beforeEach(async () => {
    const notificacion = { noLeidas: signal(0) };
    revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', ['listar']);
    revisionService.listar.and.returnValue(of([]));
    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'listarIncidencias',
      'listarEstudiantesSinPractica',
      'enviarRecordatorioEstudiante'
    ]);
    practicaService.listarIncidencias.and.returnValue(of([]));
    practicaService.listarEstudiantesSinPractica.and.returnValue(of([]));
    practicaService.enviarRecordatorioEstudiante.and.callFake(idUsuario => of(respuestaOk(idUsuario)));

    await TestBed.configureTestingModule({
      imports: [GestorHome, RecordatoriosEstudiantes],
      providers: [
        AuthStore,
        { provide: RevisionService, useValue: revisionService },
        { provide: PracticaService, useValue: practicaService },
        { provide: NotificacionService, useValue: notificacion },
        { provide: Router, useValue: routerSimulado() },
        { provide: NavController, useValue: jasmine.createSpyObj<NavController>('NavController', ['navigateRoot']) }
      ]
    }).compileComponents();

    authStore = TestBed.inject(AuthStore);
    router = TestBed.inject(Router);
    navController = TestBed.inject(NavController) as jasmine.SpyObj<NavController>;
    sessionStorage.setItem('access_token', 'test-token');
  });

  afterEach(() => {
    fixture?.destroy();
    sessionStorage.clear();
  });

  describe('datos reales y conteos', () => {
    beforeEach(() => {
      revisionService.listar.and.returnValue(of([
        solicitud(1, 'REGISTRADA', 3, 'Ana Soto'),
        solicitud(2, 'EN_REVISION', 40, 'Luis Pérez'),
        solicitud(3, 'OBSERVADA', 10, 'Carla Díaz')
      ]));
      practicaService.listarIncidencias.and.returnValue(of([
        incidencia(1, 'ABIERTA', 'MEDIA', 2),
        incidencia(2, 'EN_REVISION', 'CRITICA', 1),
        incidencia(3, 'RESUELTA', 'ALTA', 9)
      ]));
      practicaService.listarEstudiantesSinPractica.and.returnValue(of([
        estudiante(9, 'Ana', true, false),
        estudiante(10, 'Beto', false, false)
      ]));
      crear();
    });

    it('muestra el saludo con el nombre del contexto y el resumen calculado', () => {
      expect(texto()).toContain('Hola, Gestor');
      expect(texto()).toContain('Espacio de gestión');
      expect(texto()).toContain('2 solicitudes por revisar · 2 incidencias abiertas · 2 estudiantes sin práctica registrada');
    });

    it('cuenta por revisar como registradas y en revisión, y resalta antigüedad mayor a 30 días', () => {
      expect(indicador(0).querySelector('strong')?.textContent?.trim()).toBe('2');
      expect(indicador(0).textContent).toContain('1 con más de 30 días');
    });

    it('cuenta observadas por separado', () => {
      expect(indicador(1).querySelector('strong')?.textContent?.trim()).toBe('1');
    });

    it('excluye incidencias resueltas y destaca solo prioridad alta o crítica abierta', () => {
      expect(indicador(2).querySelector('strong')?.textContent?.trim()).toBe('2');
      expect(indicador(2).textContent).toContain('1 de prioridad alta');
    });

    it('cuenta estudiantes sin práctica con perfil incompleto', () => {
      expect(indicador(3).querySelector('strong')?.textContent?.trim()).toBe('2');
      expect(indicador(3).textContent).toContain('1 con perfil incompleto');
    });

    it('ordena las solicitudes de la más antigua a la más reciente', () => {
      const nombres = Array.from(fixture.nativeElement.querySelectorAll('.gh-fila strong') as NodeListOf<HTMLElement>)
        .map(elemento => elemento.textContent?.trim());
      expect(nombres).toEqual(['Luis Pérez', 'Carla Díaz', 'Ana Soto']);
    });

    it('centraliza los filtros en Solicitudes y enlaza el indicador de observadas', () => {
      expect(fixture.nativeElement.querySelector('.gh-filtros')).toBeNull();
      indicador(1).click();
      expect(router.navigate).toHaveBeenCalledWith(['/revisiones'], { queryParams: { estado: 'OBSERVADA' } });
      expect(revisionService.listar).toHaveBeenCalledTimes(1);
    });

    it('no muestra marcadores de posición en el contenido', () => {
      expect(texto()).not.toContain('[N]');
      expect(texto()).not.toContain('[Título]');
    });
  });

  describe('navegación', () => {
    beforeEach(() => {
      revisionService.listar.and.returnValue(of([solicitud(7, 'REGISTRADA', 2, 'Ana Soto')]));
      crear();
    });

    it('abre el envío de avisos desde el botón de nuevo aviso', () => {
      boton('+ Nuevo aviso')?.click();
      expect(router.navigate).toHaveBeenCalledWith(['/envio-notificaciones']);
    });

    it('abre las solicitudes desde el indicador por revisar', () => {
      indicador(0).click();
      expect(router.navigate).toHaveBeenCalledWith(['/revisiones']);
    });

    it('abre el detalle al seleccionar una solicitud', () => {
      (fixture.nativeElement.querySelector('.gh-fila') as HTMLButtonElement).click();
      expect(router.navigate).toHaveBeenCalledWith(['/revisiones', 7]);
    });
    it('Inicio limita a cinco solicitudes y envía los recordatorios a Comunicaciones', () => {
      revisionService.listar.and.returnValue(of(Array.from({ length: 12 }, (_, i) => solicitud(i + 1, 'REGISTRADA', i, `Estudiante ${i}`))));
      crear();
      expect(fixture.nativeElement.querySelectorAll('.gh-fila').length).toBe(5);
      expect(fixture.nativeElement.querySelector('.gh-estudiante')).toBeNull();
      indicador(3).click();
      expect(router.navigate).toHaveBeenCalledWith(['/envio-notificaciones'], { fragment: 'recordatorios' });
      expect(practicaService.enviarRecordatorioEstudiante).not.toHaveBeenCalled();
    });
  });

  describe('estados de carga y error por sección', () => {
    it('muestra el error de solicitudes sin ocultar estudiantes sin práctica', () => {
      revisionService.listar.and.returnValue(throwError(() => new Error('fallo')));
      practicaService.listarEstudiantesSinPractica.and.returnValue(of([estudiante(9, 'Ana', true, false)]));
      crear();
      expect(texto()).toContain('No fue posible cargar las solicitudes por revisar.');
      expect(indicador(0).querySelector('strong')?.textContent?.trim()).toBe('—');
      expect(indicador(3).querySelector('strong')?.textContent?.trim()).toBe('1');
    });

    it('muestra el error de incidencias de forma independiente', () => {
      practicaService.listarIncidencias.and.returnValue(throwError(() => new Error('fallo')));
      crear();
      expect(texto()).toContain('No fue posible cargar las incidencias.');
    });
  });

  // Sprint final: las mismas aserciones del flujo de envíos protegen ahora el componente
  // extraído a Comunicaciones, no una segunda interfaz de envío en Inicio.
  describe('recordatorios a estudiantes sin práctica en Comunicaciones', () => {
    let recordatorios: ComponentFixture<RecordatoriosEstudiantes>;
    const texto = (): string => recordatorios.nativeElement.textContent as string;
    const casillasEstudiantes = (): HTMLInputElement[] => Array.from(
      recordatorios.nativeElement.querySelectorAll('.gh-estudiante input') as NodeListOf<HTMLInputElement>);
    const boton = (etiqueta: string): HTMLButtonElement | undefined => Array.from(
      recordatorios.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(b => b.textContent?.trim().includes(etiqueta));
    // Conserva el nombre local fixture para que los pasos y aserciones de las pruebas
    // originales sigan ejercitando exactamente el mismo flujo.
    let fixture: ComponentFixture<RecordatoriosEstudiantes>;
    function crear(): void {
      recordatorios = TestBed.createComponent(RecordatoriosEstudiantes);
      fixture = recordatorios;
      fixture.detectChanges();
    }
    afterEach(() => recordatorios?.destroy());
    beforeEach(() => {
      practicaService.listarEstudiantesSinPractica.and.returnValue(of([
        estudiante(9, 'Ana', true, false),
        estudiante(10, 'Beto', true, true),
        estudiante(11, 'Carlos', true, false)
      ]));
      crear();
    });

    it('bloquea el recordatorio de quien ya recibió uno hoy', () => {
      expect(casillasEstudiantes()[1].disabled).toBeTrue();
      expect(texto()).toContain('Enviado hoy');
    });

    it('envía un solo recordatorio directamente, sin confirmación', () => {
      casillasEstudiantes()[0].click();
      fixture.detectChanges();
      boton('Enviar recordatorio a 1 estudiante')?.click();
      fixture.detectChanges();
      expect(practicaService.enviarRecordatorioEstudiante).toHaveBeenCalledOnceWith(9);
      expect(texto()).toContain('Recordatorio enviado.');
    });

    it('pide confirmación antes de varios envíos y los realiza uno a uno', () => {
      (fixture.nativeElement.querySelector('.gh-todos input') as HTMLInputElement).click();
      fixture.detectChanges();
      boton('Enviar recordatorio a 2 estudiantes')?.click();
      fixture.detectChanges();
      expect(practicaService.enviarRecordatorioEstudiante).not.toHaveBeenCalled();
      expect(texto()).toContain('Se enviará 2 recordatorios');

      boton('Confirmar envío')?.click();
      fixture.detectChanges();
      expect(practicaService.enviarRecordatorioEstudiante.calls.allArgs()).toEqual([[9], [11]]);
    });

    it('cancelar la confirmación no envía nada', () => {
      (fixture.nativeElement.querySelector('.gh-todos input') as HTMLInputElement).click();
      fixture.detectChanges();
      boton('Enviar recordatorio a 2 estudiantes')?.click();
      fixture.detectChanges();
      boton('Cancelar')?.click();
      fixture.detectChanges();
      expect(practicaService.enviarRecordatorioEstudiante).not.toHaveBeenCalled();
    });
    it('salir de Comunicaciones detiene los siguientes envíos del lote', () => {
      const respuesta = new Subject<RecordatorioEstudianteResponse>();
      practicaService.enviarRecordatorioEstudiante.and.returnValue(respuesta);
      recordatorios.componentInstance.seleccionados.set([9, 11]);
      recordatorios.componentInstance.solicitar();
      recordatorios.componentInstance.confirmar();
      recordatorios.destroy();
      respuesta.next(respuestaOk(9)); respuesta.complete();
      expect(practicaService.enviarRecordatorioEstudiante.calls.allArgs()).toEqual([[9]]);
    });
    it('evita doble envío y bloquea éxitos locales aunque el listado aún esté desactualizado', () => {
      const respuesta = new Subject<RecordatorioEstudianteResponse>();
      practicaService.enviarRecordatorioEstudiante.and.returnValue(respuesta);
      casillasEstudiantes()[0].click(); fixture.detectChanges();
      boton('Enviar recordatorio a 1 estudiante')?.click();
      recordatorios.componentInstance.solicitar();
      expect(practicaService.enviarRecordatorioEstudiante).toHaveBeenCalledTimes(1);
      respuesta.next(respuestaOk(9)); respuesta.complete(); fixture.detectChanges();
      expect(casillasEstudiantes()[0].disabled).toBeTrue();
      expect(recordatorios.componentInstance.seleccionables()).not.toContain(9);
    });

    it('reintenta solo los envíos fallidos', () => {
      practicaService.enviarRecordatorioEstudiante.and.callFake(idUsuario => idUsuario === 9
        ? throwError(() => new HttpErrorResponse({ status: 409, error: { detail: 'Ya se envió un recordatorio hoy.' } }))
        : of(respuestaOk(idUsuario)));

      (fixture.nativeElement.querySelector('.gh-todos input') as HTMLInputElement).click();
      fixture.detectChanges();
      boton('Enviar recordatorio a 2 estudiantes')?.click();
      fixture.detectChanges();
      boton('Confirmar envío')?.click();
      fixture.detectChanges();

      expect(texto()).toContain('Ya se envió un recordatorio hoy.');
      expect(texto()).toContain('1 recordatorio enviado. 1 envío fallido.');
      const reintento = boton('Reintentar 1 envío fallido');
      expect(reintento).toBeDefined();

      reintento?.click();
      fixture.detectChanges();
      expect(practicaService.enviarRecordatorioEstudiante.calls.allArgs()).toEqual([[9], [11], [9]]);
    });
  });
});
