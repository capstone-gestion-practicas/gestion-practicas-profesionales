import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EstadoBadge, presentarEstado } from './estado-badge';

describe('EstadoBadge', () => {
  let fixture: ComponentFixture<EstadoBadge>;
  let elemento: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EstadoBadge] }).compileComponents();
    fixture = TestBed.createComponent(EstadoBadge);
    elemento = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => fixture.destroy());

  function mostrar(estado: string | null): HTMLElement {
    fixture.componentRef.setInput('estado', estado);
    fixture.detectChanges();
    return elemento.querySelector('.estado-badge') as HTMLElement;
  }

  it('A: REGISTRADA usa la variante neutral', () => {
    expect(mostrar('REGISTRADA').classList).toContain('estado-badge--neutral');
  });

  it('B: EN_REVISION usa la variante info', () => {
    expect(mostrar('EN_REVISION').classList).toContain('estado-badge--info');
  });

  it('C: OBSERVADA usa la variante warning', () => {
    expect(mostrar('OBSERVADA').classList).toContain('estado-badge--warning');
  });

  it('D: EN_CURSO usa la variante primary', () => {
    expect(mostrar('EN_CURSO').classList).toContain('estado-badge--primary');
  });

  it('E: FINALIZADA usa la variante success', () => {
    expect(mostrar('FINALIZADA').classList).toContain('estado-badge--success');
  });

  it('F: RECHAZADA usa la variante danger', () => {
    expect(mostrar('RECHAZADA').classList).toContain('estado-badge--danger');
  });

  it('G: siempre muestra texto legible del estado, nunca solo color', () => {
    const esperados: Record<string, string> = {
      REGISTRADA: 'Registrada', EN_REVISION: 'En revisión', OBSERVADA: 'Observada', APROBADA: 'Aprobada',
      EN_CURSO: 'En curso', FINALIZADA: 'Finalizada', RECHAZADA: 'Rechazada'
    };
    for (const [estado, texto] of Object.entries(esperados)) {
      expect(mostrar(estado)!.textContent?.trim()).toBe(texto);
    }
  });

  it('H: un estado desconocido no rompe la pantalla y se muestra como neutral', () => {
    const badge = mostrar('ESTADO_NO_CONOCIDO');
    expect(badge.classList).toContain('estado-badge--neutral');
    expect(badge.textContent?.trim()).toBe('ESTADO_NO_CONOCIDO');
    expect(mostrar(null).textContent?.trim()).toBe('Sin estado');
  });

  it('presentarEstado normaliza mayúsculas y espacios del código recibido', () => {
    expect(presentarEstado('en_curso').variante).toBe('primary');
    expect(presentarEstado('  FINALIZADA  ').etiqueta).toBe('Finalizada');
  });
});
