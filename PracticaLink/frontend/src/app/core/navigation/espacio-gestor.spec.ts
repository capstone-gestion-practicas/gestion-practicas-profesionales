import { ContextoUsuarioResponse } from '../models/auth.models';
import { esEspacioGestorDedicado, muestraEspacioGestor } from './espacio-gestor';

describe('muestraEspacioGestor', () => {
  const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 1, nombre: 'Demo', apellido: 'Prueba', correo: 'demo@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  it('coincide con la regla previa de la cabecera para cada combinación de roles y espacio', () => {
    const casos: [string[], string | null, boolean][] = [
      [['GESTOR'], null, true],
      [['GESTOR'], 'ADMINISTRADOR', true],
      [['ESTUDIANTE', 'GESTOR'], null, true],
      [['ADMINISTRADOR'], null, false],
      [['ADMINISTRADOR'], 'GESTOR', false],
      [['GESTOR', 'ADMINISTRADOR'], null, false],
      [['GESTOR', 'ADMINISTRADOR'], 'GESTOR', true],
      [['GESTOR', 'ADMINISTRADOR'], 'ADMINISTRADOR', false],
      [['DOCENTE'], 'GESTOR', false]
    ];
    for (const [roles, espacio, esperado] of casos) {
      expect(muestraEspacioGestor(contextoCon(roles), espacio))
        .withContext(`${roles.join('+')} · ${espacio}`).toBe(esperado);
    }
    expect(muestraEspacioGestor(null, 'GESTOR')).toBeFalse();
  });
});

describe('esEspacioGestorDedicado', () => {
  const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 1, nombre: 'Demo', apellido: 'Prueba', correo: 'demo@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  it('es verdadero para un gestor sin administración', () => {
    expect(esEspacioGestorDedicado(contextoCon(['GESTOR']))).toBeTrue();
  });

  it('es verdadero para doble rol estudiante y gestor', () => {
    expect(esEspacioGestorDedicado(contextoCon(['ESTUDIANTE', 'GESTOR']))).toBeTrue();
  });

  it('es falso para administrador, aunque tenga también rol gestor', () => {
    expect(esEspacioGestorDedicado(contextoCon(['ADMINISTRADOR']))).toBeFalse();
    expect(esEspacioGestorDedicado(contextoCon(['GESTOR', 'ADMINISTRADOR']))).toBeFalse();
  });

  it('es falso sin contexto o para estudiante exclusivo', () => {
    expect(esEspacioGestorDedicado(null)).toBeFalse();
    expect(esEspacioGestorDedicado(contextoCon(['ESTUDIANTE']))).toBeFalse();
  });
});
