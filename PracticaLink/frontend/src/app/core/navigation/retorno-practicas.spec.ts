import { convertToParamMap } from '@angular/router';
import { filtrosRetornoPracticas } from './retorno-practicas';

describe('Retorno acotado al listado de prácticas', () => {
  it('conserva únicamente RUT, estado y offset con origen explícito', () => {
    expect(filtrosRetornoPracticas(convertToParamMap({
      origen: 'practicas', rut: '12345678-5', estado: 'en_curso', offset: '100', destino: '/usuarios'
    }))).toEqual({ rut: '12345678-5', estado: 'EN_CURSO', offset: 100 });
  });

  it('sin origen o desde otra sección usa el regreso seguro sin filtros', () => {
    expect(filtrosRetornoPracticas(undefined)).toBeNull();
    expect(filtrosRetornoPracticas(convertToParamMap({ rut: '12345678-5' }))).toBeNull();
    expect(filtrosRetornoPracticas(convertToParamMap({ origen: 'gestion-estados', estado: 'APROBADA' }))).toBeNull();
  });

  for (const origen of ['https://example.invalid', '//example.invalid', '/usuarios', '/practicas',
    '../practicas', 'practicas/15', 'javascript:alert(1)']) {
    it(`rechaza el destino no permitido ${origen}`, () => {
      expect(filtrosRetornoPracticas(convertToParamMap({ origen }))).toBeNull();
    });
  }

  it('rechaza valores inválidos, duplicados y offsets inseguros o fuera de página', () => {
    for (const filtro of [
      { rut: '../usuarios' }, { estado: 'EN CURSO' }, { offset: '-50' }, { offset: '51' },
      { offset: '9007199254741000' }, { origen: ['practicas', 'usuarios'] },
      { rut: ['12345678-5', '10000013-K'] }, { offset: '' }
    ]) {
      expect(filtrosRetornoPracticas(convertToParamMap({ origen: 'practicas', ...filtro }))).toBeNull();
    }
  });
});
