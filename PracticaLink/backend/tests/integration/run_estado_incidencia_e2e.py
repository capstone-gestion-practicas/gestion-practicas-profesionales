"""HU016 E2E: Chromium real -> Angular -> Uvicorn -> PostgreSQL 18.6 en Docker local.

Sin mocks HTTP, sin Supabase y sin .env. Reutiliza Browser/wait_url del E2E HU015
y LocalPostgres de run_inicio_practica, sin modificar esos módulos.
"""
import argparse
from contextlib import nullcontext
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

from run_incidencia_e2e import Browser, wait_url, BACKEND, FRONTEND
from run_inicio_practica import LocalPostgres, ROOT

LONG_OK = 'y' * 2000
LONG_BAD = 'y' * 2001
SANTIAGO_FORMAT = '%d/%m/%Y, %H:%M'


def run(report):
    import psycopg
    from psycopg import sql
    from pwdlib import PasswordHash
    from pwdlib.hashers.bcrypt import BcryptHasher
    from sqlalchemy.engine import URL
    from zoneinfo import ZoneInfo

    evidence = {'head': subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, text=True).strip(),
                'checks': [], 'http_browser': [], 'cleanup': False}
    pg = LocalPostgres('postgres:18.6')
    pg.name = 'ep06-e2e-hu016-' + pg.run_id
    pg.network = pg.name + '-net'
    pg.volume = pg.name + '-data'
    processes = []
    browsers = []
    db = None
    temporary = None

    def record(name, ok=True, detail=None, layer='Chromium'):
        evidence['checks'].append({'name': name, 'passed': bool(ok), 'layer': layer, 'detail': detail})
        print(('PASS ' if ok else 'FAIL ') + name, flush=True)
        if not ok:
            raise AssertionError(name)

    def spawn(args, cwd, env):
        process = subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, start_new_session=True)
        processes.append(process)
        return process

    def stop_processes():
        for p in reversed(processes):
            if p.poll() is None:
                os.killpg(p.pid, signal.SIGTERM)
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(p.pid, signal.SIGKILL)
                    p.wait(timeout=5)
        processes.clear()

    try:
        # Puertos fijos de Angular/CORS: no ocupar ni detener servicios existentes.
        for port in (8000, 4200):
            with socket.socket() as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(('127.0.0.1', port))
        pg.start()
        db = psycopg.connect(host=pg.host, port=5432, dbname='ep04_integration', user='postgres',
                             password=pg.admin_password, autocommit=True, connect_timeout=5,
                             passfile='/dev/null', sslmode='disable')

        def practice(state):
            return db.execute("""INSERT INTO practica(id_estudiante,id_centro,id_estado_actual)
                SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica""",
                (state,)).fetchone()[0]

        pa, pb, pf = practice('EN_CURSO'), practice('EN_CURSO'), practice('EN_CURSO')
        # Histórico previo al modelo moderno: debe sembrarse ANTES de EP06, porque los CHECK
        # de estado de EP06 (NOT VALID) se aplican también a inserciones nuevas.
        legacy_id = db.execute("""INSERT INTO incidencia(id_practica,id_usuario,descripcion,estado,fecha_resolucion)
            VALUES(%s,101,%s,'CERRADA','2026-01-02T12:00:00Z') RETURNING id_incidencia""",
            (pf, 'E2E-HU016 historico CERRADA')).fetchone()[0]
        for path in sorted((ROOT / 'scripts/BD/fixes').glob('ep05-*.sql')):
            db.execute(path.read_text())
        for path in sorted((ROOT / 'scripts/BD/fixes').glob('ep06-*.sql')):
            db.execute(path.read_text())
        credential = secrets.token_urlsafe(24)
        hashed = PasswordHash((BcryptHasher(),)).hash(credential)
        db.execute("UPDATE usuario SET password_hash=%s, correo=replace(correo,'example.invalid','example.com') "
                   "WHERE id_usuario IN(100,101,102)", (hashed,))
        # Roles sintéticos del laboratorio: sin acceso directo a incidencias/seguimientos.
        logins = {'e2e_main': None, 'e2e_follow_write': 'pl_ep05_executor',
                  'e2e_follow_read': 'pl_ep05_read_executor', 'e2e_incidence': 'pl_ep06_executor'}
        passwords = {}
        for login_name, role in logins.items():
            passwords[login_name] = secrets.token_hex(24)
            db.execute(sql.SQL('CREATE ROLE {} LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD {}')
                       .format(sql.Identifier(login_name), sql.Literal(passwords[login_name])))
            if role:
                db.execute(sql.SQL('GRANT {} TO {}').format(sql.Identifier(role), sql.Identifier(login_name)))
        for table in ('usuario', 'rol', 'usuario_rol', 'estudiante', 'practica', 'estado_practica',
                      'centro_practica', 'historial_estado'):
            db.execute(sql.SQL('GRANT SELECT ON public.{} TO e2e_main').format(sql.Identifier(table)))
            db.execute(sql.SQL('CREATE POLICY e2e_main_read ON public.{} FOR SELECT TO e2e_main USING(true)')
                       .format(sql.Identifier(table)))
        db.execute('GRANT USAGE ON SCHEMA public TO e2e_main')
        for login_name, table in [('e2e_incidence', 'incidencia'), ('e2e_follow_read', 'seguimiento'),
                                  ('e2e_follow_write', 'seguimiento'), ('e2e_main', 'incidencia')]:
            privileges = db.execute("""SELECT has_table_privilege(%s,%s,'SELECT'),
                has_table_privilege(%s,%s,'INSERT'),has_table_privilege(%s,%s,'DELETE')""",
                (login_name, table, login_name, table, login_name, table)).fetchone()
            record('privilegios mínimos ' + login_name, privileges == (False, False, False),
                   list(privileges), 'PostgreSQL')
        for fn in ('fn_cambiar_estado_incidencia', 'fn_consultar_historial_incidencia'):
            signature = {'fn_cambiar_estado_incidencia': 'incidencias_privadas.fn_cambiar_estado_incidencia(BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT)',
                         'fn_consultar_historial_incidencia': 'incidencias_privadas.fn_consultar_historial_incidencia(BIGINT,BIGINT,BIGINT,INTEGER,BIGINT)'}[fn]
            can_execute = db.execute('SELECT has_function_privilege(%s,%s,%s)',
                                     ('e2e_incidence', signature, 'EXECUTE')).fetchone()[0]
            record('EXECUTE del ejecutor HU016 sobre ' + fn, can_execute is True, layer='PostgreSQL')
        direct = db.execute("SELECT has_table_privilege('e2e_incidence','public.historial_estado_incidencia','INSERT')"
                            " OR has_table_privilege('e2e_incidence','public.historial_estado_incidencia','UPDATE')"
                            " OR has_table_privilege('e2e_incidence','public.historial_estado_incidencia','DELETE')").fetchone()[0]
        record('sin DML directo del ejecutor sobre historial_estado_incidencia', direct is False, layer='PostgreSQL')

        temporary = tempfile.TemporaryDirectory(prefix='ep06-e2e-hu016-')
        with nullcontext(temporary.name) as temp:
            env = {k: v for k, v in os.environ.items() if not any(
                word in k.upper() for word in ('DATABASE', 'SUPABASE', 'JWT', 'CHILE_RUT', 'PGPASSWORD', 'PGSERVICE'))}

            def url(login_name):
                return URL.create('postgresql+psycopg', username=login_name, password=passwords[login_name],
                                  host=pg.host, port=5432, database='ep04_integration').render_as_string(hide_password=False)

            env.update(SUPABASE_DATABASE_URL=url('e2e_main'), INCIDENCIAS_DATABASE_URL=url('e2e_incidence'),
                       SEGUIMIENTOS_DATABASE_URL=url('e2e_follow_write'),
                       SEGUIMIENTOS_LECTURA_DATABASE_URL=url('e2e_follow_read'),
                       JWT_SECRET_KEY=secrets.token_hex(32), PYTHONPATH=str(BACKEND), PYTHONDONTWRITEBYTECODE='1')
            # cwd efímero vacío: Settings no encuentra el .env real.
            spawn([sys.executable, '-B', '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000',
                   '--no-access-log', '--log-level', 'critical'], temp, env)
            wait_url('http://127.0.0.1:8000/', processes)
            spawn(['node', str(FRONTEND / 'node_modules/@angular/cli/bin/ng.js'), 'serve',
                   '--host', '127.0.0.1', '--port', '4200'], FRONTEND, {**os.environ, 'NG_CLI_ANALYTICS': 'false'})
            wait_url('http://127.0.0.1:4200/', processes)

            def start_browser(name):
                profile = Path(temp) / ('chrome-' + name)
                chrome = spawn([shutil.which('chromium'), '--headless', '--disable-gpu', '--disable-dev-shm-usage',
                                '--no-first-run', '--disable-background-networking', '--disable-sync',
                                '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
                                '--user-data-dir=' + str(profile), 'about:blank'], temp, os.environ.copy())
                active = profile / 'DevToolsActivePort'
                end = time.monotonic() + 20
                while not active.exists() and time.monotonic() < end and chrome.poll() is None:
                    time.sleep(.1)
                if not active.exists():
                    raise RuntimeError('Chromium did not expose CDP')
                port = active.read_text().splitlines()[0]
                targets = wait_url('http://127.0.0.1:' + port + '/json/list', processes)
                session = Browser(next(t['webSocketDebuggerUrl'] for t in targets if t['type'] == 'page'))
                session.name = name
                browsers.append(session)
                return session

            browser = start_browser('principal')
            evidence['browser'] = browser.call('Browser.getVersion')['product']

            # ---------- helpers de flujo: solo DOM y eventos normales del navegador ----------
            def no_local(session):
                record('sin acceso localStorage en página', session.local_access() == [], session.local_access())

            def login(session, email, secret=None):
                session.go('/login')
                session.fill('ion-input[type=email] input', email)
                session.fill('ion-input[type=password] input', secret or credential)
                session.click('Iniciar sesión')
                session.wait("location.pathname === '/home'")
                session.contains('Cerrar sesión')

            def logout(session):
                session.go('/home')
                session.click('Cerrar sesión')
                session.wait("location.pathname === '/login'")

            def list_ready(session, identifier):
                session.go('/practicas/' + str(identifier) + '?vista=incidencias')
                session.wait('''document.querySelector('[aria-label="Paginación de incidencias"]') !== null''')
                session.wait("!document.body.innerText.includes('Cargando incidencias')")

            def open_incident(session, description):
                card = ("Array.from(document.querySelectorAll('article')).find(a=>a.innerText.includes(%s))"
                        % json.dumps(description))
                session.wait('!!(' + card + ' && ' + card + '.querySelector("ion-button"))')
                session.js('(' + card + ').querySelector("ion-button").click()')
                session.wait("document.body.innerText.includes('Historial de estados') && "
                             "!document.body.innerText.includes('Cargando historial de la incidencia')")

            def register(session, identifier, text):
                session.go('/practicas/' + str(identifier) + '/incidencias/nueva')
                session.fill('#tipo-incidencia', 'SALUD', 'change')
                session.fill('#descripcion-incidencia', text)
                before = len(session.http)
                session.click('Guardar incidencia')
                session.contains('Incidencia registrada correctamente')
                record('POST 201 registro ' + text[:28], any(
                    r['method'] == 'POST' and r['status'] == 201 and r['path'] == f'/practicas/{identifier}/incidencias'
                    for r in session.http[before:]))
                no_local(session)

            def id_of(text):
                return db.execute('SELECT id_incidencia FROM incidencia WHERE descripcion=%s', (text,)).fetchone()[0]

            def state(identifier):
                return db.execute('SELECT estado, fecha_resolucion IS NOT NULL FROM incidencia WHERE id_incidencia=%s',
                                  (identifier,)).fetchone()

            def events(identifier):
                return db.execute("""SELECT estado_anterior, estado_nuevo, id_usuario, comentario, fecha
                    FROM historial_estado_incidencia WHERE id_incidencia=%s ORDER BY id_historial""",
                    (identifier,)).fetchall()

            def patches(session):
                return [r for r in session.http if r['method'] == 'PATCH']

            def submit(session, destino, comentario=None):
                session.fill('#estado-destino', destino, 'change')
                if comentario is not None:
                    session.fill('#comentario-estado', comentario)
                session.click('Confirmar cambio')

            def santiago(value):
                return value.astimezone(ZoneInfo('America/Santiago')).strftime(SANTIAGO_FORMAT)

            D = {
                'I1': 'E2E-HU016 I1 pendiente a en atencion',
                'I2': 'E2E-HU016 I2 pendiente a resuelta',
                'I3': 'E2E-HU016 I3 en atencion a resuelta',
                'API': 'E2E-HU016 API validaciones',
                'REG': 'E2E-HU016 regresion POST HU015',
                'B': 'E2E-HU016 concurrencia',
                'F': 'E2E-HU016 practica finalizada',
                'ADM': 'E2E-HU016 administrador',
            }
            LEGACY = 'E2E-HU016 historico CERRADA'

            # ---------- 1. Registro previo por interfaz (GESTOR) ----------
            login(browser, 'manager@example.com')
            record('login GESTOR mediante formulario')
            for key in ('I1', 'I2', 'I3', 'API', 'REG'):
                register(browser, pa, D[key])
            register(browser, pb, D['B'])
            register(browser, pf, D['F'])
            for key in ('I1', 'I2', 'I3', 'API', 'REG', 'B', 'F'):
                inc = id_of(D[key])
                ev = events(inc)
                record('evento inicial ' + key, state(inc)[0] == 'PENDIENTE'
                       and [e[:3] for e in ev] == [(None, 'PENDIENTE', 101)] and ev[0][3] is None,
                       layer='PostgreSQL')
            # Práctica F pasa a FINALIZADA (fixture de laboratorio); histórico incompatible sembrado.
            db.execute("UPDATE practica SET id_estado_actual=(SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA') "
                       "WHERE id_practica=%s", (pf,))
            legacy_before = db.execute('SELECT to_jsonb(i) FROM incidencia i WHERE id_incidencia=%s',
                                       (legacy_id,)).fetchone()[0]
            record('práctica F finalizada y histórico incompatible sembrado (fixture de laboratorio)', True,
                   layer='PostgreSQL')

            # ---------- 2. PENDIENTE -> EN_ATENCION con comentario opcional ----------
            list_ready(browser, pa)
            open_incident(browser, D['I1'])
            before = len(browser.http)
            submit(browser, 'EN_ATENCION', '  Revisión inicial E2E  ')
            browser.contains('Cambio de estado confirmado')
            i1 = id_of(D['I1'])
            record('PENDIENTE->EN_ATENCION HTTP 200 tras commit', any(
                r['method'] == 'PATCH' and r['status'] == 200 and r['path'] == f'/practicas/{pa}/incidencias/{i1}/estado'
                for r in browser.http[before:]))
            ev = events(i1)
            record('PENDIENTE->EN_ATENCION: estado e historial atómicos, comentario recortado',
                   state(i1)[0] == 'EN_ATENCION' and [e[:4] for e in ev[1:]]
                   == [('PENDIENTE', 'EN_ATENCION', 101, 'Revisión inicial E2E')], layer='PostgreSQL')
            record('evento de cambio no anterior al inicial (fecha de servidor)', ev[1][4] >= ev[0][4],
                   layer='PostgreSQL')
            list_ready(browser, pa)
            browser.contains('Estado: EN_ATENCION')
            open_incident(browser, D['I1'])
            browser.contains('Estado actual: EN_ATENCION')
            browser.contains('PENDIENTE → EN_ATENCION')
            browser.contains('Revisión inicial E2E')
            texto_fecha = 'Responsable: Usuario #101 · ' + santiago(ev[1][4])
            record('historial en navegador: responsable y fecha America/Santiago',
                   browser.js('document.body.innerText.includes(%s)' % json.dumps(texto_fecha)), texto_fecha)
            browser.call('Page.reload')
            list_ready(browser, pa)
            browser.contains('Estado: EN_ATENCION')
            record('persistencia del estado EN_ATENCION tras recarga')
            no_local(browser)

            # ---------- 3. PENDIENTE -> RESUELTA directa con comentario obligatorio ----------
            list_ready(browser, pa)
            open_incident(browser, D['I2'])
            base_patches = len(patches(browser))
            submit(browser, 'RESUELTA', '   ')
            browser.contains('Resolver requiere un comentario con contenido')
            record('RESUELTA con comentario solo espacios: rechazado sin PATCH',
                   len(patches(browser)) == base_patches)
            submit(browser, 'RESUELTA', LONG_BAD)
            browser.contains('Resolver requiere un comentario con contenido')
            record('RESUELTA con 2001 caracteres: rechazado sin PATCH', len(patches(browser)) == base_patches)
            submit(browser, 'RESUELTA', 'Resuelta directamente E2E')
            browser.contains('Cambio de estado confirmado')
            i2 = id_of(D['I2'])
            ev = events(i2)
            record('PENDIENTE->RESUELTA persistido con responsable y comentario',
                   state(i2) == ('RESUELTA', True) and ev[-1][:4] == ('PENDIENTE', 'RESUELTA', 101,
                                                                      'Resuelta directamente E2E'),
                   layer='PostgreSQL')
            record('RESUELTA: fecha de resolución igual a la del evento de historial',
                   db.execute('SELECT fecha_resolucion = %s FROM incidencia WHERE id_incidencia=%s',
                              (ev[-1][4], i2)).fetchone()[0] is True, layer='PostgreSQL')
            list_ready(browser, pa)
            browser.contains('Responsable de resolución: Usuario #101')
            browser.contains('Comentario: Resuelta directamente E2E')
            record('listado muestra responsable y comentario de resolución')

            # ---------- 4. EN_ATENCION -> RESUELTA con límite de 2000 ----------
            list_ready(browser, pa)
            open_incident(browser, D['I3'])
            submit(browser, 'EN_ATENCION')
            browser.contains('Cambio de estado confirmado')
            i3 = id_of(D['I3'])
            ev = events(i3)
            record('PENDIENTE->EN_ATENCION sin comentario (opcional)',
                   ev[-1][:4] == ('PENDIENTE', 'EN_ATENCION', 101, None) and state(i3)[0] == 'EN_ATENCION',
                   layer='PostgreSQL')
            list_ready(browser, pa)
            open_incident(browser, D['I3'])
            base_patches = len(patches(browser))
            submit(browser, 'RESUELTA', LONG_BAD)
            browser.contains('Resolver requiere un comentario con contenido')
            record('EN_ATENCION->RESUELTA con 2001 caracteres: rechazado sin PATCH',
                   len(patches(browser)) == base_patches)
            submit(browser, 'RESUELTA', LONG_OK)
            browser.contains('Cambio de estado confirmado')
            ev = events(i3)
            record('EN_ATENCION->RESUELTA con exactamente 2000 caracteres aceptado',
                   state(i3)[0] == 'RESUELTA' and ev[-1][:4] == ('EN_ATENCION', 'RESUELTA', 101, LONG_OK),
                   layer='PostgreSQL')

            # ---------- 5. Validaciones de API con fetch real desde Chromium ----------
            ia = id_of(D['API'])
            base = f'/practicas/{pa}/incidencias/{ia}/estado'
            r = browser.api('PATCH', base, {'estado_esperado': 'PENDIENTE', 'estado_nuevo': 'EN_ATENCION',
                                            'comentario': LONG_BAD})
            record('API comentario de 2001 caracteres rechazado', r['status'] == 422, r['status'], 'API real (fetch)')
            r = browser.api('PATCH', base, {'estado_esperado': 'PENDIENTE', 'estado_nuevo': 'RESUELTA',
                                            'comentario': '   '})
            record('API RESUELTA con comentario solo espacios rechazado', r['status'] == 422, r['status'],
                   'API real (fetch)')
            r = browser.api('PATCH', base, {'estado_esperado': 'PENDIENTE', 'estado_nuevo': 'EN_ATENCION',
                                            'comentario': None, 'id_usuario': 999})
            record('API campo de identidad enviado por el cliente rechazado', r['status'] == 422, r['status'],
                   'API real (fetch)')
            r = browser.api('PATCH', base, {'estado_esperado': 'EN_ATENCION', 'estado_nuevo': 'RESUELTA',
                                            'comentario': 'Estado esperado incorrecto'})
            record('API estado esperado desactualizado rechazado', r['status'] == 409, r['status'],
                   'API real (fetch)')
            record('validaciones API no alteraron la incidencia', state(ia) == ('PENDIENTE', False)
                   and len(events(ia)) == 1, layer='PostgreSQL')

            # ---------- 6. RESUELTA es terminal ----------
            list_ready(browser, pa)
            open_incident(browser, D['I2'])
            browser.contains('Esta incidencia se mantiene en solo lectura.')
            record('RESUELTA sin controles de transición en interfaz',
                   browser.js("!document.querySelector('#estado-destino')"))
            events_before = len(events(i2))
            for esperado, destino in (('RESUELTA', 'PENDIENTE'), ('RESUELTA', 'EN_ATENCION'), ('RESUELTA', 'RESUELTA')):
                r = browser.api('PATCH', f'/practicas/{pa}/incidencias/{i2}/estado',
                                {'estado_esperado': esperado, 'estado_nuevo': destino,
                                 'comentario': 'Intento terminal E2E'})
                record(f'RESUELTA terminal rechaza {esperado}->{destino}', r['status'] == 409, r['status'],
                       'API real (fetch)')
            record('RESUELTA terminal: sin cambios ni eventos adicionales',
                   state(i2) == ('RESUELTA', True) and len(events(i2)) == events_before, layer='PostgreSQL')

            # ---------- 7. Historial en navegador y paginación ----------
            list_ready(browser, pa)
            open_incident(browser, D['I3'])
            for text in ('Sin estado anterior → PENDIENTE', 'PENDIENTE → EN_ATENCION',
                         'EN_ATENCION → RESUELTA', LONG_OK):
                browser.contains(text)
            record('historial en navegador: evento inicial, cambios, responsable y comentario')
            siguiente_deshabilitado = browser.js("""(()=>{const n=document.querySelector(
                'nav[aria-label="Paginación del historial de incidencia"]');
                return !!n && n.querySelectorAll('ion-button')[1].disabled;})()""")
            record('paginación en navegador: con 3 eventos, Siguiente deshabilitado', siguiente_deshabilitado is True)
            paginas = []
            for offset in (0, 1, 2, 3):
                r = browser.api('GET', f'/practicas/{pa}/incidencias/{i3}/historial?limit=1&offset={offset}')
                paginas.append([r['status'], len(r['body']['items']), r['body']['hay_mas']])
            record('paginación API limit=1 recorre 3 eventos sin duplicados',
                   [p[0] for p in paginas] == [200, 200, 200, 200] and [p[1] for p in paginas] == [1, 1, 1, 0]
                   and [p[2] for p in paginas] == [True, True, False, False], paginas, 'API real (fetch)')
            r = browser.api('GET', f'/practicas/{pa}/incidencias/{i3}/historial?limit=50&offset=0')
            record('historial devuelve el último estado primero con valores reales',
                   r['body']['items'][0]['estado_nuevo'] == 'RESUELTA'
                   and r['body']['items'][0]['comentario'] == LONG_OK, layer='API real (fetch)')

            # ---------- 8. Concurrencia: dos sesiones GESTOR con el mismo estado ----------
            session2 = start_browser('concurrente')
            login(session2, 'manager@example.com')
            list_ready(browser, pb)
            list_ready(session2, pb)
            open_incident(browser, D['B'])
            open_incident(session2, D['B'])
            browser.contains('Estado actual: PENDIENTE')
            session2.contains('Estado actual: PENDIENTE')
            submit(browser, 'EN_ATENCION', 'Primera sesión toma el caso')
            browser.contains('Cambio de estado confirmado')
            record('concurrencia: primera sesión confirma (200)', any(
                r['status'] == 200 for r in patches(browser)))
            # La segunda sesión conserva PENDIENTE en pantalla y envía una transición ya obsoleta.
            submit(session2, 'RESUELTA', 'Segunda sesión con estado obsoleto')
            session2.contains('No se confirmó el cambio')
            record('concurrencia: segunda sesión recibe 409', any(r['status'] == 409 for r in patches(session2)),
                   [r['status'] for r in patches(session2)])
            list_ready(session2, pb)
            session2.contains('Estado: EN_ATENCION')
            record('concurrencia: segunda sesión consulta el estado real tras 409')
            ib = id_of(D['B'])
            ev = events(ib)
            record('concurrencia: sin evento duplicado ni transición obsoleta',
                   state(ib)[0] == 'EN_ATENCION' and [e[:2] for e in ev]
                   == [(None, 'PENDIENTE'), ('PENDIENTE', 'EN_ATENCION')], layer='PostgreSQL')
            no_local(session2)

            # ---------- 9. Regresiones HU013, HU014 y HU015 ----------
            list_ready(browser, pa)
            browser.contains(D['REG'])
            record('regresión HU015 GET: incidencia registrada por POST aparece tras consulta')
            browser.go(f'/practicas/{pa}/seguimiento/nuevo')
            browser.fill('#tipo-contacto', 'Videollamada', 'change')
            browser.fill('#observaciones', 'Seguimiento regresión HU016')
            browser.click('Guardar seguimiento')
            browser.contains('Seguimiento registrado correctamente')
            browser.click('Volver al detalle')
            browser.contains('Seguimiento regresión HU016')
            record('regresión HU013/HU014 en navegador')
            record('seguimiento persistido en PostgreSQL', db.execute(
                'SELECT count(*) FROM seguimiento WHERE id_practica=%s AND observacion=%s',
                (pa, 'Seguimiento regresión HU016')).fetchone()[0] == 1, layer='PostgreSQL')

            # ---------- 10. ADMINISTRADOR ----------
            logout(browser)
            login(browser, 'admin@example.com')
            record('login ADMINISTRADOR mediante formulario')
            register(browser, pa, D['ADM'])
            list_ready(browser, pa)
            open_incident(browser, D['ADM'])
            submit(browser, 'EN_ATENCION')
            browser.contains('Cambio de estado confirmado')
            adm = id_of(D['ADM'])
            record('ADMINISTRADOR cambia estado; responsable del historial es su identidad',
                   state(adm)[0] == 'EN_ATENCION'
                   and events(adm)[-1][:3] == ('PENDIENTE', 'EN_ATENCION', 102), layer='PostgreSQL')
            list_ready(browser, pa)
            browser.contains(D['I1'])
            record('ADMINISTRADOR consulta incidencias de otros gestores')

            # ---------- 11. Práctica finalizada ----------
            logout(browser)
            login(browser, 'manager@example.com')
            list_ready(browser, pf)
            open_incident(browser, D['F'])
            submit(browser, 'EN_ATENCION')
            browser.contains('Cambio de estado confirmado')
            record('práctica finalizada: incidencia moderna existente sí se gestiona',
                   state(id_of(D['F']))[0] == 'EN_ATENCION', layer='PostgreSQL')
            list_ready(browser, pf)
            browser.contains('CERRADA')
            open_incident(browser, LEGACY)
            browser.contains('Esta incidencia se mantiene en solo lectura.')
            record('histórico incompatible visible en solo lectura (sin controles)',
                   browser.js("!document.querySelector('#estado-destino')"))
            r = browser.api('GET', f'/practicas/{pf}/incidencias/{legacy_id}/historial?limit=50&offset=0')
            record('histórico incompatible consultable por API', r['status'] == 200 and r['body']['items'] == [],
                   r['status'], 'API real (fetch)')
            r = browser.api('PATCH', f'/practicas/{pf}/incidencias/{legacy_id}/estado',
                            {'estado_esperado': 'PENDIENTE', 'estado_nuevo': 'EN_ATENCION', 'comentario': None})
            record('histórico incompatible: transición rechazada por API', r['status'] == 409, r['status'],
                   'API real (fetch)')
            record('histórico incompatible sin conversión ni alteración de datos',
                   db.execute('SELECT to_jsonb(i) FROM incidencia i WHERE id_incidencia=%s',
                              (legacy_id,)).fetchone()[0] == legacy_before
                   and len(events(legacy_id)) == 0, layer='PostgreSQL')
            browser.go(f'/practicas/{pf}/incidencias/nueva')
            browser.contains('Solo se pueden registrar incidencias en prácticas EN_CURSO.')
            record('práctica finalizada: alta bloqueada en interfaz',
                   browser.js("document.querySelector('ion-button[type=submit]').disabled"))
            r = browser.api('POST', f'/practicas/{pf}/incidencias', {'tipo': 'SALUD', 'descripcion': 'No insertar'})
            record('práctica finalizada: alta rechazada por API', r['status'] == 409, r['status'], 'API real (fetch)')
            record('práctica finalizada: sin nuevas incidencias', db.execute(
                'SELECT count(*) FROM incidencia WHERE id_practica=%s', (pf,)).fetchone()[0] == 2, layer='PostgreSQL')

            # ---------- 12. ESTUDIANTE sin controles y rechazado por API ----------
            logout(browser)
            login(browser, 'student@example.com')
            for suffix in ('?vista=incidencias', '/incidencias/nueva'):
                browser.go(f'/practicas/{pa}' + suffix)
                browser.wait("location.pathname === '/home'")
                record('ESTUDIANTE redirigido desde ' + suffix)
            r = browser.api('GET', f'/practicas/{pa}/incidencias/{i3}/historial?limit=50&offset=0')
            record('ESTUDIANTE rechazado GET historial', r['status'] == 403, r['status'], 'API real (fetch)')
            r = browser.api('PATCH', f'/practicas/{pa}/incidencias/{ia}/estado',
                            {'estado_esperado': 'PENDIENTE', 'estado_nuevo': 'EN_ATENCION', 'comentario': 'x'})
            record('ESTUDIANTE rechazado PATCH estado', r['status'] == 403, r['status'], 'API real (fetch)')
            record('ESTUDIANTE sin efecto en la incidencia', state(ia) == ('PENDIENTE', False), layer='PostgreSQL')

            # ---------- 13. Usuario inactivo ----------
            logout(browser)
            login(browser, 'manager@example.com')
            db.execute('UPDATE usuario SET activo=false WHERE id_usuario=101')
            r = browser.api('GET', f'/practicas/{pa}/incidencias/{i3}/historial?limit=50&offset=0')
            record('usuario inactivo con JWT previo rechazado GET historial', r['status'] == 403, r['status'],
                   'API real (fetch)')
            r = browser.api('PATCH', f'/practicas/{pa}/incidencias/{ia}/estado',
                            {'estado_esperado': 'PENDIENTE', 'estado_nuevo': 'EN_ATENCION', 'comentario': 'x'})
            record('usuario inactivo con JWT previo rechazado PATCH estado', r['status'] == 403, r['status'],
                   'API real (fetch)')
            record('usuario inactivo sin efecto en la incidencia', state(ia) == ('PENDIENTE', False),
                   layer='PostgreSQL')
            browser.go('/home')
            browser.wait("location.pathname === '/login'")
            record('usuario inactivo expulsado de la interfaz')
            browser.fill('ion-input[type=email] input', 'manager@example.com')
            browser.fill('ion-input[type=password] input', credential)
            browser.click('Iniciar sesión')
            browser.contains('Correo o contraseña incorrectos.')
            record('login de usuario inactivo rechazado', browser.js("location.pathname === '/login'"))

            # ---------- 14. Sin localStorage durante toda la ejecución ----------
            for session in browsers:
                record('sin accesos localStorage durante la ejecución ' + session.name,
                       session.storage_accesses == [], session.storage_accesses)
            evidence['http_browser'] = [dict(sesion=s.name, **entry) for s in browsers for entry in s.http]
            evidence['database_summary'] = {
                'incidencias_A': db.execute('SELECT count(*) FROM incidencia WHERE id_practica=%s', (pa,)).fetchone()[0],
                'incidencias_B': db.execute('SELECT count(*) FROM incidencia WHERE id_practica=%s', (pb,)).fetchone()[0],
                'incidencias_F': db.execute('SELECT count(*) FROM incidencia WHERE id_practica=%s', (pf,)).fetchone()[0],
                'eventos_historial': db.execute('SELECT count(*) FROM historial_estado_incidencia').fetchone()[0],
            }
            for session in browsers:
                session.close()
            browsers.clear()
    except Exception as error:
        # No volcar excepciones de BD, variables de entorno ni payloads autenticados.
        evidence['failure'] = {'type': type(error).__name__,
                               'reason': str(error) if isinstance(error, (AssertionError, RuntimeError))
                               else 'Error interno del laboratorio; sin detalles sensibles'}
        print('E2E interrumpido:', evidence['failure'], flush=True)
        try:
            if browsers:
                evidence['http_browser'] = [dict(sesion=s.name, **entry) for s in browsers for entry in s.http]
                evidence['browser_errors'] = [e for s in browsers for e in s.errors]
        except Exception:
            pass
    finally:
        for session in browsers:
            try:
                session.close()
            except Exception:
                pass
        stop_processes()
        if temporary:
            temporary.cleanup()
        if db:
            db.close()
        pg.close()
        evidence['cleanup'] = all(pg.inspect_resource(kind, name) is None for kind, name in pg.candidates)
        evidence['resources'] = [{'kind': kind, 'name': name} for kind, name in pg.candidates]
        report.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
        print('Evidencia sin secretos:', report, flush=True)
        print('Limpieza confirmada:', evidence['cleanup'], flush=True)
    return 1 if 'failure' in evidence else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--docker-local', action='store_true', required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    sys.exit(run(args.report))
