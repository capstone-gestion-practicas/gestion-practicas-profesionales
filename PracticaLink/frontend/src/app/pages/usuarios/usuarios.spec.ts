import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { of, throwError } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { UsuarioAdministrable } from '../../core/models/usuario.models';
import { UsuarioService } from '../../core/services/usuario.service';
import { AuthStore } from '../../core/store/auth.store';
import { Usuarios } from './usuarios';

describe('Usuarios (eliminación lógica)', () => {
  let fixture: ComponentFixture<Usuarios>;
  let component: Usuarios;
  let usuarioService: jasmine.SpyObj<UsuarioService>;
  let alertController: jasmine.SpyObj<AlertController>;
  let authStore: AuthStore;

  const contextoCon = (idUsuario: number): ContextoUsuarioResponse => ({
    usuario: { id_usuario: idUsuario, nombre: 'Admin', apellido: 'Demo', correo: 'admin@practicalink.cl' },
    roles: ['ADMINISTRADOR'],
    perfil: null,
    practica_actual: null
  });

  const usuarioDocente: UsuarioAdministrable = {
    id_usuario: 20, nombre: 'Dora', apellido: 'Docente', correo: 'dora@practicalink.cl',
    activo: true, roles: ['DOCENTE']
  };

  beforeEach(async () => {
    usuarioService = jasmine.createSpyObj<UsuarioService>('UsuarioService', ['listar', 'listarRoles', 'actualizar', 'crear']);
    usuarioService.listar.and.returnValue(of([usuarioDocente]));
    usuarioService.listarRoles.and.returnValue(of([]));
    usuarioService.actualizar.and.returnValue(of({ id_usuario: 20, mensaje: 'ok' }));
    alertController = jasmine.createSpyObj<AlertController>('AlertController', ['create']);

    await TestBed.configureTestingModule({
      imports: [Usuarios],
      providers: [
        AuthStore,
        { provide: UsuarioService, useValue: usuarioService },
        { provide: AlertController, useValue: alertController },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) }
      ]
    }).compileComponents();

    authStore = TestBed.inject(AuthStore);
  });

  function crear(idAdminConectado: number): void {
    authStore.setContexto(contextoCon(idAdminConectado));
    fixture = TestBed.createComponent(Usuarios);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const botonEliminar = (): HTMLButtonElement | undefined =>
    Array.from(fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLButtonElement>)
      .find(boton => boton.textContent?.trim() === 'Desactivar cuenta');

  it('desactiva la cuenta con PATCH activo=false conservando datos y roles', () => {
    crear(1);
    component.desactivar(usuarioDocente);
    expect(usuarioService.actualizar).toHaveBeenCalledWith(20, {
      nombre: 'Dora', apellido: 'Docente', activo: false, roles: ['DOCENTE']
    });
    expect(usuarioService.listar).toHaveBeenCalledTimes(2);
  });

  it('muestra el detalle del backend cuando la desactivación falla', () => {
    usuarioService.actualizar.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 409, error: { detail: 'No puedes desactivar tu cuenta ni quitarte el rol administrador' }
    })));
    crear(1);
    component.desactivar(usuarioDocente);
    fixture.detectChanges();
    expect(component.errorAccion).toBe('No puedes desactivar tu cuenta ni quitarte el rol administrador');
    expect(fixture.nativeElement.querySelector('p.error')?.textContent).toContain('No puedes desactivar');
    expect(component.desactivando).toBeFalse();
  });

  it('muestra «Desactivar cuenta» en usuarios activos ajenos y lo deshabilita en la cuenta propia', () => {
    crear(1);
    expect(botonEliminar()).toBeDefined();
    expect(botonEliminar()?.disabled).toBeFalse();

    usuarioService.listar.and.returnValue(of([{ ...usuarioDocente, id_usuario: 1 }]));
    crear(1);
    expect(botonEliminar()?.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('No puedes desactivar tu propia cuenta.');
  });

  it('no ofrece eliminar cuentas ya inactivas', () => {
    usuarioService.listar.and.returnValue(of([{ ...usuarioDocente, activo: false }]));
    crear(1);
    expect(botonEliminar()).toBeUndefined();
  });

  it('confirma con un diálogo y solo desactiva si el administrador acepta', async () => {
    const alerta = jasmine.createSpyObj<HTMLIonAlertElement>('Alert', ['present']);
    alertController.create.and.resolveTo(alerta as never);
    crear(1);

    await component.confirmarEliminar(usuarioDocente);
    expect(alertController.create).toHaveBeenCalled();
    expect(usuarioService.actualizar).not.toHaveBeenCalled();

    const opciones = alertController.create.calls.mostRecent().args[0] as { buttons: { text: string; handler?: () => void }[] };
    opciones.buttons.find(boton => boton.text === 'Desactivar')?.handler?.();
    expect(usuarioService.actualizar).toHaveBeenCalledWith(20, jasmine.objectContaining({ activo: false }));
  });

  it('filtra la lista completa antes de paginar y no realiza nuevas consultas', () => {
    const usuarios = Array.from({ length: 27 }, (_, indice) => ({
      ...usuarioDocente, id_usuario: indice + 20, nombre: `Cuenta ${indice}`, activo: indice % 2 === 0,
      roles: indice % 2 === 0 ? ['GESTOR', 'DOCENTE'] : ['ESTUDIANTE']
    }));
    usuarioService.listar.and.returnValue(of(usuarios)); crear(1);
    expect(component.usuarios.length).toBe(27);
    expect(component.visibles.length).toBe(12);
    expect(component.totalPaginas).toBe(3);
    component.cambiarPagina(3);
    expect(component.visibles.length).toBe(3);
    component.busqueda = 'Cuenta 26'; component.actualizarFiltros(); fixture.detectChanges();
    expect(component.pagina).toBe(1);
    expect(component.visibles.map(usuario => usuario.id_usuario)).toEqual([46]);
    expect(fixture.nativeElement.textContent).toContain('1 coincidencias de 27 usuarios cargados');
    component.busqueda = ''; component.filtroRol = 'GESTOR'; component.filtroActivo = 'activo'; component.actualizarFiltros();
    expect(component.filtrados.length).toBe(14);
    expect(component.totalPaginas).toBe(2);
    component.filtroActivo = 'inactivo'; component.actualizarFiltros(); fixture.detectChanges();
    expect(component.visibles.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('No hay usuarios que coincidan');
    expect(usuarioService.listar).toHaveBeenCalledTimes(1);
  });

  it('conserva creación, edición de roles y reactivación con sus contratos', () => {
    usuarioService.crear.and.returnValue(of({ id_usuario: 42, mensaje: 'Creado' }));
    crear(1); component.abrirCrear();
    component.nombre = 'Nueva'; component.apellido = 'Cuenta'; component.correo = 'nueva@example.invalid';
    component.password = 'Synthetic-only-123'; component.rolesSeleccionados = ['GESTOR', 'DOCENTE'];
    component.guardar();
    expect(usuarioService.crear).toHaveBeenCalledWith(jasmine.objectContaining({ roles: ['GESTOR', 'DOCENTE'], correo: 'nueva@example.invalid' }));
    component.abrirEditar({ ...usuarioDocente, activo: false });
    component.activo = true; component.alternarRol('GESTOR', true); component.guardar();
    expect(usuarioService.actualizar).toHaveBeenCalledWith(20, {
      nombre: 'Dora', apellido: 'Docente', activo: true, roles: ['DOCENTE', 'GESTOR']
    });
  });
});
