import { ContextoUsuarioResponse } from '../models/auth.models';
import { esEspacioGestorDedicado } from './espacio-gestor';

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
