import { SolicitudRevisionResumen } from '../../core/models/revision.models';
import {
  TAMANO_PAGINA,
  ordenDesdeParametro,
  parametroDesdeOrden,
  paginaDesdeParametro,
  antiguedadDias,
  contarPorEstado,
  contarPorRevisar,
  estadosDesdeParametro,
  fechaEnvio,
  filtrarSolicitudes,
  normalizarTexto,
  ordenarSolicitudes,
  paginar,
  parametroDesdeEstados
} from './solicitudes-listado';

const solicitud = (
  id: number,
  estudiante: string,
  estado: string,
  fecha: string,
  centro = 'Centro demostrativo'
): SolicitudRevisionResumen => ({
  id_practica: id,
  fecha_registro: fecha,
  estado,
  estudiante,
  rut_estudiante: '12.345.678-5',
  centro_practica: centro
});

describe('solicitudes-listado', () => {
  const lista: SolicitudRevisionResumen[] = [
    solicitud(1, 'Ana Pérez', 'REGISTRADA', '2026-09-03T10:00:00', 'Municipalidad Norte'),
    solicitud(2, 'Bruno Soto', 'EN_REVISION', '2026-09-01T09:00:00', 'Empresa Sur'),
    solicitud(3, 'Carla Muñoz', 'OBSERVADA', '2026-09-02T12:00:00', 'Clínica Central'),
    solicitud(4, 'Ángel Díaz', 'REGISTRADA', '2026-09-04T08:30:00', 'Empresa Sur')
  ];

  describe('normalizarTexto', () => {
    it('quita tildes, pasa a minúsculas y colapsa espacios', () => {
      expect(normalizarTexto('  Ángel   DÍAZ ')).toBe('angel diaz');
    });
  });

  describe('estadosDesdeParametro', () => {
    it('sin parámetro no hay filtro', () => {
      expect(estadosDesdeParametro(null)).toEqual({ estados: [], desconocidos: [] });
      expect(estadosDesdeParametro('  ')).toEqual({ estados: [], desconocidos: [] });
    });

    it('acepta los códigos en minúsculas y con guion bajo', () => {
      expect(estadosDesdeParametro('registrada').estados).toEqual(['REGISTRADA']);
      expect(estadosDesdeParametro('en_revision').estados).toEqual(['EN_REVISION']);
      expect(estadosDesdeParametro('observada').estados).toEqual(['OBSERVADA']);
    });

    it('acepta varios estados separados por coma, en orden canónico y sin repetir', () => {
      expect(estadosDesdeParametro('observada,registrada,registrada').estados).toEqual(['REGISTRADA', 'OBSERVADA']);
    });

    it('informa los códigos desconocidos y conserva los válidos', () => {
      expect(estadosDesdeParametro('aprobada,en_revision')).toEqual({
        estados: ['EN_REVISION'],
        desconocidos: ['aprobada']
      });
    });

    it('solo códigos desconocidos dejan la lista sin filtro', () => {
      expect(estadosDesdeParametro('rechazada').estados).toEqual([]);
    });
  });

  describe('parametroDesdeEstados', () => {
    it('devuelve el valor canónico o null sin filtro', () => {
      expect(parametroDesdeEstados([])).toBeNull();
      expect(parametroDesdeEstados(['REGISTRADA', 'EN_REVISION'])).toBe('registrada,en_revision');
    });

    it('es reversible con estadosDesdeParametro', () => {
      const original = ['EN_REVISION', 'OBSERVADA'] as const;
      expect(estadosDesdeParametro(parametroDesdeEstados(original)!).estados).toEqual([...original]);
    });
  });

  describe('filtrarSolicitudes', () => {
    it('sin estado ni búsqueda devuelve todas', () => {
      expect(filtrarSolicitudes(lista, [], '').length).toBe(4);
    });

    it('filtra por varios estados', () => {
      const resultado = filtrarSolicitudes(lista, ['REGISTRADA', 'OBSERVADA'], '');
      expect(resultado.map(item => item.id_practica).sort()).toEqual([1, 3, 4]);
    });

    it('busca por nombre del estudiante sin distinguir tildes ni mayúsculas', () => {
      expect(filtrarSolicitudes(lista, [], 'angel').map(item => item.id_practica)).toEqual([4]);
      expect(filtrarSolicitudes(lista, [], 'PÉREZ').map(item => item.id_practica)).toEqual([1]);
    });

    it('busca por centro de práctica', () => {
      expect(filtrarSolicitudes(lista, [], 'empresa sur').map(item => item.id_practica).sort()).toEqual([2, 4]);
    });

    it('combina estado y búsqueda', () => {
      expect(filtrarSolicitudes(lista, ['REGISTRADA'], 'sur').map(item => item.id_practica)).toEqual([4]);
    });

    it('no muta el arreglo original', () => {
      const copia = [...lista];
      filtrarSolicitudes(lista, ['REGISTRADA'], '');
      expect(lista).toEqual(copia);
    });
  });

  describe('ordenarSolicitudes', () => {
    it('ordena de la más antigua a la más reciente', () => {
      expect(ordenarSolicitudes(lista, 'ANTIGUAS').map(item => item.id_practica)).toEqual([2, 3, 1, 4]);
    });

    it('ordena de la más reciente a la más antigua', () => {
      expect(ordenarSolicitudes(lista, 'RECIENTES').map(item => item.id_practica)).toEqual([4, 1, 3, 2]);
    });

    it('ordena por estudiante A–Z ignorando tildes', () => {
      expect(ordenarSolicitudes(lista, 'ESTUDIANTE').map(item => item.estudiante)).toEqual([
        'Ana Pérez', 'Ángel Díaz', 'Bruno Soto', 'Carla Muñoz'
      ]);
    });

    it('no altera el arreglo recibido', () => {
      const orden = lista.map(item => item.id_practica);
      ordenarSolicitudes(lista, 'RECIENTES');
      expect(lista.map(item => item.id_practica)).toEqual(orden);
    });
  });

  describe('conteos', () => {
    it('cuenta por estado sobre el listado completo y el total', () => {
      expect(contarPorEstado(lista)).toEqual({ REGISTRADA: 2, EN_REVISION: 1, OBSERVADA: 1, total: 4 });
    });

    it('por revisar suma REGISTRADA y EN_REVISION, sin contar observadas', () => {
      expect(contarPorRevisar(lista)).toBe(3);
    });

    it('un estado fuera del catálogo no suma a ningún contador, pero sí al total', () => {
      const conDesconocido = [...lista, solicitud(9, 'X', 'APROBADA', '2026-09-05T00:00:00')];
      expect(contarPorEstado(conDesconocido).total).toBe(5);
      expect(contarPorRevisar(conDesconocido)).toBe(3);
    });
  });

  describe('paginar', () => {
    const numeros = Array.from({ length: 25 }, (_, indice) => indice + 1);

    it('usa 10 registros por página por defecto', () => {
      expect(TAMANO_PAGINA).toBe(10);
      const primera = paginar(numeros, 1);
      expect(primera.elementos.length).toBe(10);
      expect(primera.paginas).toBe(3);
      expect(primera.desde).toBe(1);
      expect(primera.hasta).toBe(10);
    });

    it('la última página muestra el resto', () => {
      const ultima = paginar(numeros, 3);
      expect(ultima.elementos).toEqual([21, 22, 23, 24, 25]);
      expect(ultima.desde).toBe(21);
      expect(ultima.hasta).toBe(25);
    });

    it('acota la página solicitada al rango válido', () => {
      expect(paginar(numeros, 99).pagina).toBe(3);
      expect(paginar(numeros, 0).pagina).toBe(1);
      expect(paginar(numeros, -4).pagina).toBe(1);
    });

    it('una lista vacía tiene una página sin rango', () => {
      expect(paginar([], 1)).toEqual({ elementos: [], pagina: 1, paginas: 1, desde: 0, hasta: 0 });
    });
  });

  describe('parámetros de búsqueda, orden y página en la URL', () => {
    it('orden: lee valores conocidos y usa el predeterminado en el resto', () => {
      expect(ordenDesdeParametro('recientes')).toBe('RECIENTES');
      expect(ordenDesdeParametro('ESTUDIANTE')).toBe('ESTUDIANTE');
      expect(ordenDesdeParametro('cualquiera')).toBe('ANTIGUAS');
      expect(ordenDesdeParametro(null)).toBe('ANTIGUAS');
    });

    it('orden: el predeterminado no se escribe en la URL', () => {
      expect(parametroDesdeOrden('ANTIGUAS')).toBeNull();
      expect(parametroDesdeOrden('RECIENTES')).toBe('recientes');
      expect(ordenDesdeParametro(parametroDesdeOrden('ESTUDIANTE'))).toBe('ESTUDIANTE');
    });

    it('página: acepta enteros positivos y usa la primera página en el resto', () => {
      expect(paginaDesdeParametro('3')).toBe(3);
      expect(paginaDesdeParametro('0')).toBe(1);
      expect(paginaDesdeParametro('-2')).toBe(1);
      expect(paginaDesdeParametro('2.5')).toBe(1);
      expect(paginaDesdeParametro('abc')).toBe(1);
      expect(paginaDesdeParametro(null)).toBe(1);
    });
  });

  describe('fecha y antigüedad', () => {
    it('formatea la fecha de envío en zona de Santiago', () => {
      expect(fechaEnvio(solicitud(1, 'A', 'REGISTRADA', '2026-09-03T10:00:00'))).toMatch(/^03\D09\D2026$/);
    });

    it('marca fecha inválida como sin fecha y no calcula antigüedad', () => {
      const invalida = solicitud(1, 'A', 'REGISTRADA', 'no-es-fecha');
      expect(fechaEnvio(invalida)).toBe('Sin fecha');
      expect(antiguedadDias(invalida)).toBeNull();
    });

    it('calcula días completos desde el envío', () => {
      const envio = solicitud(1, 'A', 'REGISTRADA', '2026-09-01T00:00:00');
      const ahora = Date.parse('2026-09-11T12:00:00');
      expect(antiguedadDias(envio, ahora)).toBe(10);
    });
  });
});
