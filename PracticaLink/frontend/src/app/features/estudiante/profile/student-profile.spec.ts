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

  it('no muestra controles de edición; el único botón es copiar el correo', () => {
    const fixture = crear(completo);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('input, textarea, select').length).toBe(0);
    const botones = el.querySelectorAll('button');
    expect(botones.length).toBe(1);
    expect(botones[0].textContent?.trim()).toBe('Copiar correo');
    expect(texto(fixture)).not.toMatch(/Guardar|Editar/);
  });

  describe('copiar correo', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    afterEach(() => {
      if (original) {
        Object.defineProperty(navigator, 'clipboard', original);
      } else {
        delete (navigator as unknown as { clipboard?: unknown }).clipboard;
      }
    });

    function portapapeles(writeText: ((texto: string) => Promise<void>) | undefined): void {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
    }

    async function pulsarCopia(fixture: ReturnType<typeof crear>): Promise<void> {
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.student-profile__copiar')?.click();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('copia el correo real y confirma con una región de estado', async () => {
      const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
      portapapeles(writeText);
      const fixture = crear(completo);
      await pulsarCopia(fixture);
      expect(writeText).toHaveBeenCalledWith('ana@example.test');
      const estado = (fixture.nativeElement as HTMLElement).querySelector('[role="status"].student-profile__estado-copia');
      expect(estado?.textContent?.trim()).toBe('Correo copiado al portapapeles.');
    });

    it('deshabilita la acción cuando no hay correo', () => {
      portapapeles(jasmine.createSpy('writeText').and.returnValue(Promise.resolve()));
      const fixture = crear({ ...completo, usuario: { ...completo.usuario, correo: '   ' } });
      const boton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.student-profile__copiar');
      expect(boton?.disabled).toBeTrue();
    });

    it('informa un error si la copia falla', async () => {
      portapapeles(() => Promise.reject(new Error('denegado')));
      const fixture = crear(completo);
      await pulsarCopia(fixture);
      const estado = (fixture.nativeElement as HTMLElement).querySelector('.student-profile__estado-copia');
      expect(estado?.textContent?.trim()).toBe('No fue posible copiar el correo.');
    });

    it('explica que el navegador no permite copiar cuando no hay API de portapapeles', async () => {
      portapapeles(undefined);
      const fixture = crear(completo);
      await pulsarCopia(fixture);
      const estado = (fixture.nativeElement as HTMLElement).querySelector('.student-profile__estado-copia');
      expect(estado?.textContent?.trim()).toBe('Tu navegador no permite copiar el correo automáticamente.');
    });
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
