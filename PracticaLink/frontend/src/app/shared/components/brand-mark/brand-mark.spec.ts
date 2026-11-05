import { TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular';

import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  function crear(variante: 'completa' | 'compacta' = 'completa', tono: 'claro' | 'oscuro' = 'claro'): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [BrandMark], providers: [provideIonicAngular()] });
    const fixture = TestBed.createComponent(BrandMark);
    fixture.componentRef.setInput('variante', variante);
    fixture.componentRef.setInput('tono', tono);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('muestra el icono académico del Login y el nombre', () => {
    const elemento = crear();
    expect(elemento.querySelector('ion-icon')?.getAttribute('name')).toBe('school-outline');
    expect(elemento.querySelector('.brand-mark__nombre')?.textContent).toContain('PracticaLink');
  });

  it('mantiene el icono decorativo', () => {
    const elemento = crear();
    expect(elemento.querySelector('ion-icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('usa el tono claro por defecto y el oscuro cuando se indica', () => {
    expect(crear().querySelector('.brand-mark')?.classList).not.toContain('brand-mark--oscuro');
    expect(crear('completa', 'oscuro').querySelector('.brand-mark')?.classList).toContain('brand-mark--oscuro');
  });

  it('aplica la variante compacta', () => {
    expect(crear('compacta').querySelector('.brand-mark')?.classList).toContain('brand-mark--compacta');
  });

  it('no trunca el nombre completo en el ancho útil del sidebar (220 px) y sí lo detecta cuando no cabe', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [BrandMark], providers: [provideIonicAngular()] });
    const fixture = TestBed.createComponent(BrandMark);
    fixture.componentRef.setInput('variante', 'completa');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const marca = host.querySelector('.brand-mark') as HTMLElement;
    const nombre = host.querySelector('.brand-mark__nombre') as HTMLElement;

    host.style.width = '220px';
    marca.style.width = '100%';
    fixture.detectChanges();
    expect(nombre.scrollWidth).toBeLessThanOrEqual(nombre.clientWidth);

    // Control negativo: en un ancho insuficiente el truncamiento sí se mide.
    host.style.width = '120px';
    fixture.detectChanges();
    expect(nombre.scrollWidth).toBeGreaterThan(nombre.clientWidth);
  });
});
