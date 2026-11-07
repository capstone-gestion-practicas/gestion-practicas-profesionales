import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { SolicitudRevisionDetalle } from '../../core/models/revision.models';
import { RevisionService } from '../../core/services/revision.service';
import { AuthStore } from '../../core/store/auth.store';
import { RevisionDetalle } from './revision-detalle';
import { codigosInternosVisibles } from '../../shared/testing/codigos-internos';

describe('RevisionDetalle', () => {
  let component: RevisionDetalle;
  let fixture: ComponentFixture<RevisionDetalle>;
  let revisionService: jasmine.SpyObj<RevisionService>;
  let router: jasmine.SpyObj<Router>;
  let authStore: AuthStore;

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

  const contexto = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Demo', correo: 'gestor@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  let parametrosOrigen: Record<string, string>;

  const crearRuta = (): { snapshot: unknown } => ({
    snapshot: {
      paramMap: convertToParamMap({ id: '101' }),
      queryParamMap: convertToParamMap(parametrosOrigen)
    }
  });

  const texto = (): string => fixture.nativeElement.textContent.replace(/\s+/g, ' ');
  const boton = (nombre: string): HTMLElement | undefined =>
    Array.from(fixture.nativeElement.querySelectorAll('ion-button, button') as NodeListOf<HTMLElement>)
      .find(item => item.textContent?.replace(/\s+/g, ' ').trim() === nombre);

  /** Valor (dd) asociado a una etiqueta (dt) de la lista de datos. */
  const valorDe = (etiqueta: string): string | undefined => {
    const dt = Array.from(fixture.nativeElement.querySelectorAll('dt') as NodeListOf<HTMLElement>)
      .find(item => item.textContent?.trim() === etiqueta);
    return dt?.nextElementSibling?.textContent?.trim();
  };

  beforeEach(async () => {
    parametrosOrigen = {};
    revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', [
      'obtener',
      'resolver'
    ]);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [RevisionDetalle],
      providers: [
        { provide: ActivatedRoute, useFactory: crearRuta },
        { provide: Router, useValue: router },
        { provide: RevisionService, useValue: revisionService }
      ]
    }).compileComponents();

    authStore = TestBed.inject(AuthStore);
    authStore.setContexto(contexto(['GESTOR']));
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

    expect(texto()).toContain('Aprobar');
    expect(texto()).toContain('Observar');
    expect(texto()).toContain('Rechazar');
  });

  it('sends APROBADA when approving', () => {
    createLoadedComponent();
    revisionService.resolver.and.returnValue(
      of({ id_practica: 101, estado: 'APROBADA', mensaje: 'Solicitud revisada correctamente' })
    );

    openDecision('APROBADA');
    component.confirmar();

    expect(revisionService.resolver).toHaveBeenCalledWith(101, 'APROBADA', null);
    expect(router.navigate).toHaveBeenCalledWith(['/revisiones'], { queryParams: {} });
    expect(component.guardando).toBeFalse();
  });

  it('sends OBSERVADA with an observation', () => {
    createLoadedComponent();
    revisionService.resolver.and.returnValue(
      of({ id_practica: 101, estado: 'OBSERVADA', mensaje: 'Solicitud revisada correctamente' })
    );

    openDecision('OBSERVADA');
    component.observacion = 'Faltan antecedentes';
    component.confirmar();

    expect(revisionService.resolver).toHaveBeenCalledWith(101, 'OBSERVADA', 'Faltan antecedentes');
    expect(router.navigate).toHaveBeenCalledWith(['/revisiones'], { queryParams: {} });
  });

  it('sends RECHAZADA with an observation', () => {
    createLoadedComponent();
    revisionService.resolver.and.returnValue(
      of({ id_practica: 101, estado: 'RECHAZADA', mensaje: 'Solicitud revisada correctamente' })
    );

    openDecision('RECHAZADA');
    component.observacion = 'No cumple requisitos';
    component.confirmar();

    expect(revisionService.resolver).toHaveBeenCalledWith(101, 'RECHAZADA', 'No cumple requisitos');
    expect(router.navigate).toHaveBeenCalledWith(['/revisiones'], { queryParams: {} });
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
    revisionService.obtener.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    fixture = TestBed.createComponent(RevisionDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.error).toBe('No fue posible cargar la solicitud.');
    expect(texto()).toContain('No fue posible cargar la solicitud.');
  });

  it('shows an error when the resolution service fails', () => {
    createLoadedComponent();
    revisionService.resolver.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 500,
      error: { detail: 'No fue posible guardar la decisión.' }
    })));

    openDecision('APROBADA');
    component.confirmar();

    expect(component.error).toBe('No fue posible guardar la decisión.');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  describe('datos del estudiante y de la práctica', () => {
    it('muestra estudiante, empresa y práctica con etiquetas de gestión', () => {
      createLoadedComponent();
      expect(texto()).toContain('Ana Perez');
      expect(texto()).toContain('12.345.678-5');
      expect(texto()).toContain('Centro de prueba');
      expect(texto()).toContain('Av. Siempre Viva 123');
      expect(texto()).toContain('Maria Perez');
      expect(texto()).toContain('Jefa de practica');
    });

    it('formatea fechas en español de Chile y muestra horas con unidad', () => {
      createLoadedComponent();
      expect(texto()).toContain('02/03/2026');
      expect(texto()).toContain('30/06/2026');
      expect(texto()).toContain('360 h');
    });

    it('no inventa datos: un campo vacío se muestra como no informado', () => {
      revisionService.obtener.and.returnValue(of({ ...detalle, sede: '', contacto_cargo: null }));
      fixture = TestBed.createComponent(RevisionDetalle);
      component = fixture.componentInstance;
      fixture.detectChanges();
      expect(valorDe('Sede')).toBe('No informado');
      expect(valorDe('Cargo del contacto')).toBe('No informado');
    });

    it('muestra el estado con su etiqueta de presentación', () => {
      createLoadedComponent();
      expect(fixture.nativeElement.querySelector('app-estado-badge')?.textContent).toContain('Registrada');
    });

    it('no muestra códigos internos de épica o historia de usuario en la interfaz', () => {
      createLoadedComponent();
      const codigos = codigosInternosVisibles(fixture.nativeElement);
      expect(codigos).toEqual([]);
    });

    it('conserva el nombre del estudiante como encabezado principal', () => {
      createLoadedComponent();
      expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe('Ana Perez');
    });
  });

  describe('disponibilidad de decisiones por estado', () => {
    for (const estado of ['REGISTRADA', 'EN_REVISION', 'OBSERVADA']) {
      it(`admite decisiones en ${estado}`, () => {
        revisionService.obtener.and.returnValue(of({ ...detalle, estado }));
        fixture = TestBed.createComponent(RevisionDetalle);
        component = fixture.componentInstance;
        fixture.detectChanges();
        expect(boton('Aprobar')).toBeDefined();
        expect(boton('Observar')).toBeDefined();
        expect(boton('Rechazar')).toBeDefined();
      });
    }

    for (const estado of ['APROBADA', 'RECHAZADA', 'EN_CURSO', 'FINALIZADA']) {
      it(`no ofrece decisiones en ${estado} y explica la causa`, () => {
        revisionService.obtener.and.returnValue(of({ ...detalle, estado }));
        fixture = TestBed.createComponent(RevisionDetalle);
        component = fixture.componentInstance;
        fixture.detectChanges();
        expect(boton('Aprobar')).toBeUndefined();
        expect(fixture.nativeElement.querySelector('.motivo')?.textContent?.trim().length).toBeGreaterThan(0);
      });
    }

    it('abrir una decisión no revisable muestra la causa y no abre el panel', () => {
      revisionService.obtener.and.returnValue(of({ ...detalle, estado: 'APROBADA' }));
      fixture = TestBed.createComponent(RevisionDetalle);
      component = fixture.componentInstance;
      fixture.detectChanges();
      component.abrirDecision('RECHAZADA');
      expect(component.decisionAbierta).toBeFalse();
      expect(component.error).toContain('ya fue aprobada');
    });
  });

  describe('observación y envío', () => {
    it('Observar muestra la observación como obligatoria', () => {
      createLoadedComponent();
      openDecision('OBSERVADA');
      expect((fixture.nativeElement.querySelector('.observacion') as unknown as { label: string }).label).toBe('Observación obligatoria');
    });

    it('Aprobar deja la observación opcional', () => {
      createLoadedComponent();
      openDecision('APROBADA');
      expect((fixture.nativeElement.querySelector('.observacion') as unknown as { label: string }).label).toBe('Observación (opcional)');
    });

    it('no envía dos veces con clics repetidos mientras la decisión está en curso', () => {
      createLoadedComponent();
      const pendiente = new Subject<{ id_practica: number; estado: string; mensaje: string }>();
      revisionService.resolver.and.returnValue(pendiente.asObservable());

      openDecision('APROBADA');
      component.confirmar();
      component.confirmar();
      component.confirmar();

      expect(revisionService.resolver).toHaveBeenCalledTimes(1);
      expect(component.guardando).toBeTrue();
    });

    it('cancelar la decisión cierra el panel sin enviar nada', () => {
      createLoadedComponent();
      openDecision('RECHAZADA');
      component.observacion = 'borrador';
      component.cancelarDecision();
      expect(component.decisionAbierta).toBeFalse();
      expect(component.observacion).toBe('');
      expect(revisionService.resolver).not.toHaveBeenCalled();
    });
  });

  describe('formulario genérico de estado retirado', () => {
    it('la pantalla no muestra el formulario de actualización de estado', () => {
      createLoadedComponent();
      expect(texto()).not.toContain('Actualización de estado');
      expect(texto()).not.toContain('Guardar estado');
      expect(texto()).not.toContain('Nuevo estado');
      expect(fixture.nativeElement.querySelector('ion-select')).toBeNull();
    });
  });

  describe('navegación, filtros de origen y reintento', () => {
    it('Volver conserva estado, búsqueda, orden y página del listado de origen', () => {
      parametrosOrigen = { estado: 'registrada,en_revision', q: 'ana', orden: 'recientes', pagina: '2' };
      createLoadedComponent();
      boton('← Volver a solicitudes')?.click();
      expect(router.navigate).toHaveBeenCalledWith(['/revisiones'], {
        queryParams: { estado: 'registrada,en_revision', q: 'ana', orden: 'recientes', pagina: '2' }
      });
    });

    it('tras una decisión correcta se conservan los mismos filtros', () => {
      parametrosOrigen = { estado: 'observada', q: 'bruno' };
      createLoadedComponent();
      revisionService.resolver.and.returnValue(of({ id_practica: 101, estado: 'APROBADA', mensaje: 'ok' }));
      openDecision('APROBADA');
      component.confirmar();
      expect(router.navigate).toHaveBeenCalledWith(['/revisiones'], {
        queryParams: { estado: 'observada', q: 'bruno' }
      });
    });

    it('un identificador no válido en el enlace directo muestra error sin consultar', () => {
      TestBed.resetTestingModule();
      revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', ['obtener', 'resolver']);
      TestBed.configureTestingModule({
        imports: [RevisionDetalle],
        providers: [
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: { paramMap: convertToParamMap({ id: 'abc' }), queryParamMap: convertToParamMap({}) }
            }
          },
          { provide: Router, useValue: router },
          { provide: RevisionService, useValue: revisionService }
        ]
      });
      fixture = TestBed.createComponent(RevisionDetalle);
      component = fixture.componentInstance;
      fixture.detectChanges();
      expect(revisionService.obtener).not.toHaveBeenCalled();
      expect(component.error).toBe('La solicitud indicada no es válida.');
    });

    it('Reintentar vuelve a consultar la solicitud tras un error de carga', () => {
      revisionService.obtener.and.returnValues(
        throwError(() => new HttpErrorResponse({ status: 503 })),
        of(detalle)
      );
      fixture = TestBed.createComponent(RevisionDetalle);
      component = fixture.componentInstance;
      fixture.detectChanges();
      expect(component.error).toBe('No fue posible cargar la solicitud.');

      boton('Reintentar')?.click();
      fixture.detectChanges();
      expect(revisionService.obtener).toHaveBeenCalledTimes(2);
      expect(component.solicitud?.estudiante).toBe('Ana Perez');
      expect(component.error).toBe('');
    });
  });

  describe('roles', () => {
    it('GESTOR y ADMINISTRADOR ven el mismo panel de revisión (la restricción de rol está en las rutas)', () => {
      authStore.setContexto(contexto(['ADMINISTRADOR']));
      createLoadedComponent();
      expect(boton('Aprobar')).toBeDefined();
    });
  });
});
