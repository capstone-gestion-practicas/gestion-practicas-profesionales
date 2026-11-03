"""HU017 rendimiento: PostgreSQL 18.6 Docker exclusivo con volumen sintético.

Mide la consulta agregada que usa fn_resumen_incidencias_pendientes y evalúa un
índice candidato dentro de una transacción que se revierte. No crea índices
permanentes. Datos 100 % sintéticos.
"""
import argparse
import json
import signal
import sys
import time

from run_inicio_practica import ROOT
from run_historial_seguimiento import connection
from run_historial_seguimiento import suite as read_suite
from run_registro_seguimiento import SeguimientoPostgres, make_suite as write_suite
from run_registro_incidencia import suite as incidence_suite
from run_consulta_incidencias import suite as consulta_suite

SQL = ROOT / 'scripts/BD/fixes/ep06-08-resumen-pendientes.sql'
AGGREGATE = """SELECT i.id_practica,
       count(*) FILTER (WHERE i.estado='PENDIENTE') AS pendientes,
       count(*) FILTER (WHERE i.estado='EN_ATENCION') AS en_atencion,
       min(i.fecha) FILTER (WHERE i.estado='PENDIENTE') AS fecha_pendiente_antigua
FROM public.incidencia i
WHERE i.estado IN ('PENDIENTE','EN_ATENCION')
GROUP BY i.id_practica
HAVING count(*) FILTER (WHERE i.estado='PENDIENTE') > 0
ORDER BY fecha_pendiente_antigua ASC, id_practica ASC
LIMIT 51"""
CANDIDATE = ('CREATE INDEX ep06_hu017_candidato ON public.incidencia(estado,id_practica) INCLUDE (fecha)')
PRACTICES, INCIDENCES = 2000, 50000


def seed(db):
    db.execute(f"""INSERT INTO practica(id_estudiante,id_centro,id_estado_actual)
        SELECT 100,100,(SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO')
        FROM generate_series(1,{PRACTICES})""")
    db.execute(f"""INSERT INTO incidencia(id_practica,id_usuario,id_tipo_incidencia,fecha,descripcion,estado,fecha_resolucion)
        SELECT p.id_practica, 101, (SELECT id_tipo_incidencia FROM tipo_incidencia WHERE codigo='OTRO'),
               TIMESTAMPTZ '2026-01-01 00:00:00+00' + (g * INTERVAL '1 minute'),
               'Texto sintético',
               CASE WHEN g % 10 = 0 THEN 'PENDIENTE' WHEN g % 10 = 1 THEN 'EN_ATENCION' ELSE 'RESUELTA' END,
               CASE WHEN g % 10 >= 2 THEN TIMESTAMPTZ '2026-02-01 00:00:00+00' END
        FROM generate_series(1,{INCIDENCES}) g
        JOIN LATERAL (SELECT id_practica FROM practica ORDER BY id_practica OFFSET (g % {PRACTICES}) LIMIT 1) p ON true""")
    db.execute('ANALYZE public.incidencia')


def timed_explain(db, sql_text):
    started = time.perf_counter()
    rows = db.execute('EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ' + sql_text).fetchall()
    elapsed = (time.perf_counter() - started) * 1000
    plan = [r[0] for r in rows]
    scan = next((line.strip() for line in plan if 'Scan' in line), 'sin nodo de escaneo')
    return {'nodo_principal': scan, 'ms_total': round(elapsed, 1), 'plan': plan}


def run(pg):
    report = {'volumen': {'practicas': PRACTICES, 'incidencias': INCIDENCES}}
    # Misma cadena de construcción que run_resumen_pendientes.main: cada suite aplica
    # sus DDL versionados (EP04/EP05 esquemas, luego EP06-01..04) antes de la siguiente.
    with connection(pg) as db:
        legacy = db.execute("INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='FINALIZADA' RETURNING id_practica").fetchone()[0]
        db.execute("INSERT INTO seguimiento(id_practica,id_usuario,fecha,tipo,observacion) VALUES(%s,102,'2026-07-01 02:30:00+00',NULL,'')", (legacy,))
    write_suite(pg)
    read_suite(pg, legacy)
    incidence_suite(pg)
    consulta_suite(pg)
    with connection(pg) as db:
        db.execute(SQL.read_text())
        seed(db)
        report['sin_indice_adicional'] = timed_explain(db, AGGREGATE)
        db.execute('BEGIN')
        try:
            db.execute(CANDIDATE)
            db.execute('ANALYZE public.incidencia')
            report['con_indice_candidato'] = timed_explain(db, AGGREGATE)
        finally:
            db.execute('ROLLBACK')
        report['indice_candidato_revertido'] = db.execute(
            "SELECT count(*)=0 FROM pg_indexes WHERE indexname='ep06_hu017_candidato'").fetchone()[0]
        started = time.perf_counter()
        result = db.execute('SELECT incidencias_privadas.fn_resumen_incidencias_pendientes(101,50,0)').fetchone()[0]
        report['funcion_ms'] = round((time.perf_counter() - started) * 1000, 1)
        report['funcion_items_pagina'] = len(result['items'])
        report['funcion_hay_mas'] = result['hay_mas']
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local', action='store_true', required=True)
    parser.add_argument('--report', default=None)
    args = parser.parse_args()
    pg = SeguimientoPostgres('postgres:18.6')
    pg.name = 'ep06-hu017-plan-' + pg.run_id
    pg.network, pg.volume = pg.name + '-net', pg.name + '-data'

    def interrupted(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    code = 1
    try:
        pg.start()
        report = run(pg)
        print(json.dumps({k: v for k, v in report.items() if not k.endswith('plan')}, ensure_ascii=False, indent=2))
        if args.report:
            with open(args.report, 'w', encoding='utf-8') as handle:
                json.dump(report, handle, ensure_ascii=False, indent=2)
        code = 0
    except (Exception, KeyboardInterrupt) as error:
        print('HU017 plan no completado:', type(error).__name__, file=sys.stderr)
    finally:
        try:
            pg.close()
        except Exception:
            print('Limpieza pendiente: revisar solo candidatos enumerados.', file=sys.stderr)
            code = 1
    return code


if __name__ == '__main__':
    sys.exit(main())
