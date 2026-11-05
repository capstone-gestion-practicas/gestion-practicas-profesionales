import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { AuthStore } from '../../../core/store/auth.store';
import { StudentProfile } from './student-profile';

describe('StudentProfile (solo lectura)', () => {
  const completo: ContextoUsuarioResponse = {
    usuario: { id_usuario: 27, nombre: 'Ana', apellido: 'Pérez Soto', correo: 'ana@example.test' },
    roles: ['ESTUDIANTE'],
    perfil: { id_estudiante: 7, rut: '12.345.678-5', carrera: 'Ingeniería Comercial', sede: 'Santiago Centro' },
    practica_actual: null
  };

  function crear(contexto: ContextoUsuarioResponse | null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [StudentProfile], providers: [provideRouter([])] });
    const store = TestBed.inject(AuthStore);
    if (contexto) store.setContexto(contexto); else store.limpiar();
    const fixture = TestBed.createComponent(StudentProfile);
    fixture.detectChanges();
    return fixture;
  }

  const texto = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.textContent as string;

  it('muestra nombre completo y los datos de cuenta y académicos reales', () => {
    const fixture = crear(completo);
    expect(texto(fixture)).toContain('Ana Pérez Soto');
    expect(texto(fixture)).toContain('ana@example.test');
    expect(texto(fixture)).toContain('12.345.678-5');
    expect(texto(fixture)).toContain('Ingeniería Comercial');
    expect(texto(fixture)).toContain('Santiago Centro');
  });

  it('marca como «No registrado» los datos académicos cuando el perfil no existe', () => {
    const fixture = crear({ ...completo, perfil: null });
    expect(texto(fixture)).toContain('No registrado');
    expect(texto(fixture)).toContain('Tu perfil académico aún no está completo');
    expect(texto(fixture)).not.toContain('12.345.678-5');
  });

  it('usa «No registrado» para un apellido vacío sin dejar espacios sobrantes', () => {
    const fixture = crear({ ...completo, usuario: { ...completo.usuario, apellido: '   ' } });
    const nombre = fixture.nativeElement.querySelector('.student-profile__nombre') as HTMLElement;
    expect(nombre.textContent?.trim()).toBe('Ana');
    expect(texto(fixture)).toContain('No registrado');
  });

  it('no muestra ningún control de edición ni de guardado', () => {
    const fixture = crear(completo);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('input, textarea, select, button').length).toBe(0);
    expect(texto(fixture)).not.toMatch(/Guardar|Editar/);
  });

  it('tiene un único h1 con el título «Mi perfil»', () => {
    const fixture = crear(completo);
    const titulos = (fixture.nativeElement as HTMLElement).querySelectorAll('h1');
    expect(titulos.length).toBe(1);
    expect(titulos[0].textContent?.trim()).toBe('Mi perfil');
  });

  it('muestra un estado seguro cuando no hay contexto', () => {
    const fixture = crear(null);
    expect(texto(fixture)).toContain('No hay datos de cuenta disponibles.');
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')).toBeNull();
  });
});
