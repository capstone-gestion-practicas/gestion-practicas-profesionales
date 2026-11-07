import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { SolicitudRevisionResumen } from '../../core/models/revision.models';
import { RevisionService } from '../../core/services/revision.service';
import { SolicitudesPendientesService } from '../../core/services/solicitudes-pendientes.service';
import { AuthStore } from '../../core/store/auth.store';
import { Revisiones } from './revisiones';
import { codigosInternosVisibles } from '../../shared/testing/codigos-internos';

describe('Revisiones', () => {
  let component: Revisiones;
  let fixture: ComponentFixture<Revisiones>;
  let revisionService: jasmine.SpyObj<RevisionService>;
  let router: jasmine.SpyObj<Router>;
  let pendientes: jasmine.SpyObj<SolicitudesPendientesService>;
  let query$: BehaviorSubject<ParamMap>;
  let authStore: AuthStore;

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

  /** Datos sintéticos para paginación: 12 solicitudes con fechas y nombres distintos. */
  const muchas = (): SolicitudRevisionResumen[] =>
    Array.from({ length: 12 }, (_, indice) => ({
      id_practica: 300 + indice,
      fecha_registro: `2026-08-${String(indice + 1).padStart(2, '0')}T08:00:00`,
      estado: indice % 3 === 0 ? 'OBSERVADA' : 'REGISTRADA',
      estudiante: `Estudiante ${String(indice + 1).padStart(2, '0')}`,
      rut_estudiante: `10.000.00${indice}-K`,
      centro_practica: indice % 2 === 0 ? 'Centro Sur' : 'Centro Norte'
    }));

  const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Demo', correo: 'gestor@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  const texto = (): string => fixture.nativeElement.textContent.replace(/\s+/g, ' ');
  const filas = (): HTMLTableRowElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
  /** Busca por texto en botones nativos y en ion-button (los controles de paginación son ion-button). */
  const boton = (nombre: string): HTMLElement | undefined =>
    Array.from(fixture.nativeElement.querySelectorAll('button, ion-button') as NodeListOf<HTMLElement>)
      .find(item => item.textContent?.replace(/\s+/g, ' ').trim().startsWith(nombre));
  const deshabilitado = (nombre: string): boolean =>
    (boton(nombre) as unknown as { disabled: boolean }).disabled === true;

  function crear(lista: SolicitudRevisionResumen[] | 'error' = solicitudes): void {
    if (lista === 'error') {
      revisionService.listar.and.returnValue(throwError(() => new Error('network error')));
    } else {
      revisionService.listar.and.returnValue(of(lista));
    }
    fixture = TestBed.createComponent(Revisiones);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', [
      'listar'
    ]);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    pendientes = jasmine.createSpyObj<SolicitudesPendientesService>('SolicitudesPendientesService', ['publicar', 'refrescar']);
    query$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));

    await TestBed.configureTestingModule({
      imports: [Revisiones],
      providers: [
        { provide: RevisionService, useValue: revisionService },
        { provide: Router, useValue: router },
        { provide: SolicitudesPendientesService, useValue: pendientes },
        { provide: ActivatedRoute, useValue: { queryParamMap: query$.asObservable() } }
      ]
    }).compileComponents();

    authStore = TestBed.inject(AuthStore);
    authStore.setContexto(contextoCon(['GESTOR']));
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('renders the list when the service returns requests', () => {
    crear();

    expect(component.solicitudes).toEqual(solicitudes);
    expect(texto()).toContain('Solicitudes');
    expect(texto()).toContain('Ana Perez');
    expect(texto()).toContain('Bruno Soto');
    expect(texto()).toContain('Centro de prueba');
    expect(texto()).toContain('Centro Norte');
    expect(texto()).toContain('Revisar antecedentes');
    expect(filas().length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.solicitud-tarjeta').length).toBe(2);
  });

  it('shows the student associated with each request', () => {
    crear();

    expect(texto()).toContain('Ana Perez');
    expect(texto()).toContain('Bruno Soto');
    expect(texto()).toContain('RUT');
    expect(texto()).toContain('12.345.678-5');
    expect(texto()).toContain('11.222.333-4');
  });

  it('shows the current state for each request with its presentation label', () => {
    crear();

    expect(texto()).toContain('Estado');
    expect(texto()).toContain('Registrada');
    expect(texto()).toContain('En revisión');
  });

  it('shows an empty state when there are no requests', () => {
    crear([]);

    expect(component.solicitudes).toEqual([]);
    expect(texto()).toContain('No hay solicitudes pendientes.');
    expect(fixture.nativeElement.querySelectorAll('.state-card').length).toBe(1);
  });

  it('shows an error when loading fails', () => {
    crear('error');

    expect(component.error).toBe('No fue posible cargar las solicitudes.');
    expect(texto()).toContain('No fue posible cargar las solicitudes.');
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

  describe('carga y contador', () => {
    it('carga sin interacción una sola vez por entrada a la página', () => {
      crear();
      expect(revisionService.listar).toHaveBeenCalledTimes(1);
    });

    it('publica el contador de solicitudes por revisar con el listado cargado', () => {
      crear();
      expect(pendientes.publicar).toHaveBeenCalledWith(solicitudes);
    });

    it('reintenta la carga desde el estado de error', () => {
      crear('error');
      revisionService.listar.and.returnValue(of(solicitudes));
      boton('Reintentar')?.click();
      fixture.detectChanges();
      expect(revisionService.listar).toHaveBeenCalledTimes(2);
      expect(component.error).toBe('');
      expect(texto()).toContain('Ana Perez');
    });
  });

  describe('búsqueda', () => {
    it('busca por estudiante y por centro, sin distinguir mayúsculas ni tildes', () => {
      crear();
      component.alBuscar('BRUNO');
      fixture.detectChanges();
      expect(filas().length).toBe(1);
      expect(texto()).toContain('Bruno Soto');

      component.alBuscar('centro norte');
      fixture.detectChanges();
      expect(texto()).toContain('Bruno Soto');
      expect(texto()).not.toContain('Ana Perez');
    });

    it('muestra el vacío por filtro y permite limpiar los filtros', () => {
      crear();
      component.alBuscar('zzz');
      fixture.detectChanges();
      expect(texto()).toContain('No hay solicitudes con estos filtros.');
      boton('Limpiar filtros')?.click();
      fixture.detectChanges();
      expect(component.busqueda()).toBe('');
      expect(filas().length).toBe(2);
    });
  });

  describe('filtros por estado', () => {
    it('muestra conteos reales y marca el filtro activo con aria-pressed', () => {
      crear();
      expect(boton('Todas')?.getAttribute('aria-pressed')).toBe('true');
      expect(boton('Registradas')?.textContent).toContain('(1)');
      expect(boton('En revisión')?.textContent).toContain('(1)');
      expect(boton('Observadas')?.textContent).toContain('(0)');

      component.alternarEstado('REGISTRADA');
      fixture.detectChanges();
      expect(boton('Registradas')?.getAttribute('aria-pressed')).toBe('true');
      expect(boton('Todas')?.getAttribute('aria-pressed')).toBe('false');
      expect(filas().length).toBe(1);
    });

    it('volver a pulsar un estado lo quita; sin estados seleccionados se muestran todas', () => {
      crear();
      component.alternarEstado('REGISTRADA');
      component.alternarEstado('REGISTRADA');
      fixture.detectChanges();
      expect(component.estados()).toEqual([]);
      expect(filas().length).toBe(2);
    });

    it('actualiza la URL con Angular Router sin recargar, reemplazando el historial', () => {
      crear();
      component.alternarEstado('OBSERVADA');
      expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({
        queryParams: { estado: 'observada' },
        replaceUrl: true
      }));
    });

    it('la pastilla Todas limpia el parámetro de la URL', () => {
      crear();
      component.alternarEstado('OBSERVADA');
      component.mostrarTodas();
      expect(router.navigate.calls.mostRecent().args[0]).toEqual([]);
      expect(router.navigate.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
        queryParams: {}
      }));
    });
  });

  describe('query params', () => {
    it('aplica ?estado=en_revision al abrir la URL directamente', () => {
      query$.next(convertToParamMap({ estado: 'en_revision' }));
      crear();
      expect(component.estados()).toEqual(['EN_REVISION']);
      expect(filas().length).toBe(1);
      expect(texto()).toContain('Bruno Soto');
    });

    it('acepta varios estados separados por coma', () => {
      query$.next(convertToParamMap({ estado: 'registrada,en_revision' }));
      crear();
      expect(component.estados()).toEqual(['REGISTRADA', 'EN_REVISION']);
      expect(filas().length).toBe(2);
    });

    it('ignora estados desconocidos y lo informa, sin bloquear la lista', () => {
      query$.next(convertToParamMap({ estado: 'aprobada,observada' }));
      crear();
      expect(component.estados()).toEqual(['OBSERVADA']);
      expect(component.estadosDesconocidos()).toEqual(['aprobada']);
      expect(texto()).toContain('Se ignoraron filtros no válidos en la dirección: aprobada.');
    });

    it('sin códigos válidos la página muestra todas las solicitudes', () => {
      query$.next(convertToParamMap({ estado: 'desconocido' }));
      crear();
      expect(component.estados()).toEqual([]);
      expect(filas().length).toBe(2);
    });
  });

  describe('ordenamiento', () => {
    it('ordena por defecto de la más antigua a la más reciente', () => {
      crear();
      expect(filas()[0].textContent).toContain('Ana Perez');
    });

    it('permite ordenar de la más reciente a la más antigua y por estudiante', () => {
      crear();
      component.alOrdenar('RECIENTES');
      fixture.detectChanges();
      expect(filas()[0].textContent).toContain('Bruno Soto');

      component.alOrdenar('ESTUDIANTE');
      fixture.detectChanges();
      expect(filas()[0].textContent).toContain('Ana Perez');
    });

    it('no altera el arreglo recibido del servicio', () => {
      crear();
      component.alOrdenar('RECIENTES');
      expect(component.solicitudes.map(item => item.id_practica)).toEqual([101, 202]);
    });
  });

  describe('paginación local', () => {
    it('muestra 10 registros por página con el rango y los controles', () => {
      crear(muchas());
      expect(filas().length).toBe(10);
      expect(texto()).toContain('Mostrando 1–10 de 12 solicitudes');
      expect(texto()).toContain('Página 1 de 2');
      expect(deshabilitado('Anterior')).toBeTrue();
      expect(deshabilitado('Siguiente')).toBeFalse();
    });

    it('avanza a la página siguiente y deshabilita Siguiente al final', () => {
      crear(muchas());
      boton('Siguiente')?.click();
      fixture.detectChanges();
      expect(filas().length).toBe(2);
      expect(texto()).toContain('Mostrando 11–12 de 12 solicitudes');
      expect(deshabilitado('Siguiente')).toBeTrue();
    });

    it('reinicia a la página 1 al cambiar la búsqueda o el filtro', () => {
      crear(muchas());
      boton('Siguiente')?.click();
      fixture.detectChanges();
      component.alBuscar('Estudiante');
      fixture.detectChanges();
      expect(texto()).toContain('Página 1 de');
      expect(component.pagina().pagina).toBe(1);
    });
  });

  describe('presentación de la pantalla', () => {
    it('no muestra códigos internos de épica o historia de usuario', () => {
      crear();
      const codigos = codigosInternosVisibles(fixture.nativeElement);
      expect(codigos).toEqual([]);
    });

    it('usa la etiqueta de gestión en lugar del código de épica', () => {
      crear();
      expect(fixture.nativeElement.querySelector('.module-label')?.textContent?.trim()).toBe('Gestión de prácticas');
    });

    it('conserva identificadores reales de práctica en las acciones de cada solicitud', () => {
      crear();
      const accion = fixture.nativeElement.querySelector('tbody tr ion-button') as HTMLElement;
      expect(accion.getAttribute('aria-label')).toContain('Ana Perez');
    });
  });

  describe('estado completo del listado en la URL', () => {
    it('escribe búsqueda, orden y página además del estado', () => {
      crear(muchas());
      component.alOrdenar('RECIENTES');
      component.alBuscar('centro');
      component.confirmarBusqueda();
      component.paginaSiguiente();
      expect(router.navigate.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
        queryParams: { q: 'centro', orden: 'recientes', pagina: 2 }
      }));
    });

    it('restaura búsqueda, orden y página desde la URL al abrir el listado', () => {
      query$.next(convertToParamMap({ q: 'bruno', orden: 'estudiante', pagina: '1' }));
      crear();
      expect(component.busqueda()).toBe('bruno');
      expect(component.orden()).toBe('ESTUDIANTE');
      expect(texto()).toContain('Bruno Soto');
    });

    it('al abrir el detalle lleva los parámetros actuales del listado', () => {
      query$.next(convertToParamMap({ estado: 'registrada', q: 'ana' }));
      crear();
      component.revisar(101);
      expect(router.navigate).toHaveBeenCalledWith(['/revisiones', 101], {
        queryParams: { estado: 'registrada', q: 'ana' }
      });
    });
  });

  describe('navegación y permisos', () => {
    it('abre el detalle de la solicitud desde la acción de la fila', () => {
      crear();
      component.revisar(101);
      expect(router.navigate).toHaveBeenCalledWith(['/revisiones', 101], { queryParams: {} });
    });

    it('la acción tiene nombre accesible con el estudiante', () => {
      crear();
      const accion = fixture.nativeElement.querySelector('tbody tr ion-button') as HTMLElement;
      expect(accion.getAttribute('aria-label')).toBe('Revisar antecedentes de Ana Perez');
    });

    it('el gestor dedicado no muestra Volver', () => {
      crear();
      expect(component.mostrarVolver()).toBeFalse();
      expect(texto()).not.toContain('Volver');
    });

    it('el administrador conserva el botón Volver', () => {
      authStore.setContexto(contextoCon(['ADMINISTRADOR']));
      crear();
      expect(component.mostrarVolver()).toBeTrue();
      expect(texto()).toContain('Volver');
    });
  });
});
