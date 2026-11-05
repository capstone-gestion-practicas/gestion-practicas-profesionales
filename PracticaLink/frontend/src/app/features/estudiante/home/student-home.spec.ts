import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { By } from '@angular/platform-browser';

import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { AuthStore } from '../../../core/store/auth.store';
import { StudentHome } from './student-home';

@Component({ standalone: true, template: 'Mi práctica' })
class MiPracticaFake {}

describe('StudentHome', () => {
  let fixture: ComponentFixture<StudentHome>;
  let store: AuthStore;

  const contextoBase: ContextoUsuarioResponse = {
    usuario: { id_usuario: 7, nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.test' },
    roles: ['ESTUDIANTE'],
    perfil: { id_estudiante: 7, rut: '12345678-5', carrera: 'Ingeniería', sede: 'Santiago' },
    practica_actual: null
  };

  function crear(contexto: ContextoUsuarioResponse | null = contextoBase): void {
    TestBed.configureTestingModule({
      imports: [StudentHome],
      providers: [provideRouter([{ path: 'estudiante/mi-practica', component: MiPracticaFake }])]
    });
    store = TestBed.inject(AuthStore);
    if (contexto) store.setContexto(contexto);
    fixture = TestBed.createComponent(StudentHome);
    fixture.detectChanges();
  }

  it('renderiza una sola cabecera h1 con el saludo y datos del contexto', () => {
    crear();
    expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Hola, Ana Pérez');
    expect(fixture.nativeElement.textContent).toContain('Ingeniería');
    expect(fixture.nativeElement.textContent).toContain('Santiago');
    expect(fixture.nativeElement.textContent).toContain('ana@example.test');
  });

  it('solicita completar perfil cuando falta el perfil sin duplicar el flujo', () => {
    crear({ ...contextoBase, perfil: null });
    spyOn(fixture.componentInstance.solicitarCompletarPerfil, 'emit');
    const botones = fixture.nativeElement.querySelectorAll('button');
    expect(botones.length).toBe(1);
    botones[0].click();
    expect(fixture.componentInstance.solicitarCompletarPerfil.emit).toHaveBeenCalled();
  });

  it('solicita registrar práctica cuando existe perfil y no hay práctica', () => {
    crear();
    spyOn(fixture.componentInstance.solicitarRegistroPractica, 'emit');
    const boton = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'))
      .find((item) => item.textContent?.includes('Registrar práctica'));
    expect(boton).toBeDefined();
    boton?.click();
    expect(fixture.componentInstance.solicitarRegistroPractica.emit).toHaveBeenCalled();
  });

  it('muestra estado desconocido de forma segura y solo fecha/calendario y horas disponibles', () => {
    crear({
      ...contextoBase,
      practica_actual: {
        id_practica: 12,
        estado: { id_estado: 99, nombre: 'ESTADO_NUEVO', es_final: false },
        centro_practica: { id_centro: 3, nombre: 'Centro de prueba' },
        fecha_inicio: '2026-02-03', fecha_termino: null, horas: 360, horas_semanales: null,
        cargo_funcion: null
      }
    });
    expect(fixture.nativeElement.textContent).toContain('ESTADO_NUEVO');
    expect(fixture.nativeElement.textContent).toContain('03/02/2026');
    expect(fixture.nativeElement.textContent).toContain('360 h');
    expect(fixture.nativeElement.textContent).not.toContain('Horas completadas');
    expect(fixture.nativeElement.textContent).not.toContain('%');
  });

  it('representa los estados conocidos sin proponer acciones adicionales para estados terminales', () => {
    crear();
    const estados: ReadonlyArray<readonly [string, string]> = [
      ['REGISTRADA', 'Registrada'], ['EN_REVISION', 'En revisión'], ['APROBADA', 'Aprobada'],
      ['EN_CURSO', 'En curso'], ['FINALIZADA', 'Finalizada'], ['RECHAZADA', 'Rechazada']
    ];
    for (const [nombre, etiqueta] of estados) {
      store.setContexto({
        ...contextoBase,
        practica_actual: {
          id_practica: 12,
          estado: { id_estado: 1, nombre, es_final: nombre === 'FINALIZADA' || nombre === 'RECHAZADA' },
          centro_practica: { id_centro: 3, nombre: 'Centro de prueba' },
          fecha_inicio: null, fecha_termino: null, horas: null, horas_semanales: null, cargo_funcion: null
        }
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(etiqueta);
      expect(fixture.nativeElement.querySelectorAll('button').length).toBe(0);
    }
  });

  it('ofrece Mi práctica para una práctica observada', async () => {
    crear({
      ...contextoBase,
      practica_actual: {
        id_practica: 12,
        estado: { id_estado: 3, nombre: 'OBSERVADA', es_final: false },
        centro_practica: { id_centro: 3, nombre: 'Centro de prueba' },
        fecha_inicio: null, fecha_termino: null, horas: null, horas_semanales: null, cargo_funcion: null
      }
    });
    const enlace = fixture.debugElement.query(By.directive(RouterLink));
    expect(enlace).toBeTruthy();
    expect(enlace.nativeElement.getAttribute('href')).toBe('/estudiante/mi-practica');
    await enlace.nativeElement.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/estudiante/mi-practica');
  });

  it('no consulta servicios de práctica ni historial, y no duplica shell', () => {
    crear();
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-student-layout')).toBeNull();
    expect(fixture.nativeElement.querySelector('aside, nav, header[role="banner"]')).toBeNull();
  });

  it('presenta contexto ausente sin inventar información ni acciones', () => {
    crear(null);
    expect(fixture.nativeElement.textContent).toContain('No hay contexto de usuario disponible');
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(0);
  });

  it('omite los campos opcionales que no entrega el contexto', () => {
    crear({
      ...contextoBase,
      practica_actual: {
        id_practica: 12,
        estado: { id_estado: 1, nombre: 'REGISTRADA', es_final: false },
        centro_practica: { id_centro: 3, nombre: 'Empresa' },
        fecha_inicio: null, fecha_termino: null, horas: null, horas_semanales: null, cargo_funcion: null
      }
    });
    expect(fixture.nativeElement.textContent).not.toContain('Fecha de inicio');
    expect(fixture.nativeElement.textContent).not.toContain('Fecha de término');
    expect(fixture.nativeElement.textContent).not.toContain('Horas estimadas');
  });

  it('la línea de etapas marca como completada, actual y pendiente según el estado real', () => {
    crear({ ...contextoBase, practica_actual: { id_practica: 1, estado: { id_estado: 2, nombre: 'EN_REVISION', es_final: false }, centro_practica: { id_centro: 3, nombre: 'Centro' }, fecha_inicio: null, fecha_termino: null, horas: null, horas_semanales: null, cargo_funcion: null } });
    const etapas = fixture.componentInstance.lineaDeEtapas();
    expect(etapas?.map(etapa => etapa.estado)).toEqual(['completada', 'actual', 'pendiente', 'pendiente', 'pendiente']);
  });

  it('OBSERVADA se sitúa en la etapa de revisión y muestra su mensaje', () => {
    crear({ ...contextoBase, practica_actual: { id_practica: 1, estado: { id_estado: 2, nombre: 'OBSERVADA', es_final: false }, centro_practica: { id_centro: 3, nombre: 'Centro' }, fecha_inicio: null, fecha_termino: null, horas: null, horas_semanales: null, cargo_funcion: null } });
    expect(fixture.componentInstance.lineaDeEtapas()?.[1].estado).toBe('actual');
    expect(fixture.nativeElement.textContent).toContain('Tu práctica tiene observaciones');
  });

  it('RECHAZADA no muestra línea de etapas', () => {
    crear({ ...contextoBase, practica_actual: { id_practica: 1, estado: { id_estado: 2, nombre: 'RECHAZADA', es_final: false }, centro_practica: { id_centro: 3, nombre: 'Centro' }, fecha_inicio: null, fecha_termino: null, horas: null, horas_semanales: null, cargo_funcion: null } });
    expect(fixture.componentInstance.lineaDeEtapas()).toBeNull();
    expect(fixture.nativeElement.querySelector('.student-home__etapas')).toBeNull();
  });
});
