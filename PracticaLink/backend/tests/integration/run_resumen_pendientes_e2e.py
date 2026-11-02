"""HU017 E2E real: Chromium -> Angular -> Uvicorn -> PostgreSQL 18.6 en Docker local.

Sin mocks HTTP, sin Supabase y sin .env. Reutiliza Browser y wait_url del E2E HU015
y LocalPostgres de run_inicio_practica, sin modificar esos módulos.
Registra solo método, ruta, estado y conteos: nunca cabeceras, JWT ni contraseñas.
"""
import argparse
from contextlib import nullcontext
import json
import os
from pathlib import Path
import re
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

SUMMARY = '/practicas/con-incidencias-pendientes'
EXTRAS = 120            # prácticas sintéticas con 1 PENDIENTE: fuerzan dos páginas del resumen
STUDENT2_BODY = 22222222
LEGACY = [('ABIERTA', None), ('EN_REVISION', None), ('CERRADA', '2026-01-02T12:00:00Z')]

# Helpers de DOM: solo lectura. Ionic traslada aria-label del host ion-button al <button>
# interno de su shadow DOM; el identificador se lee de ahí. No se llama a métodos de componentes.
ID_OF_CARD = ("const idOfCard=(c)=>{const b=c.querySelector('ion-button');if(!b)return null;"
              "const inner=b.shadowRoot&&b.shadowRoot.querySelector('button');"
              "const label=(inner&&inner.getAttribute('aria-label'))||b.getAttribute('aria-label')||'';"
              "const m=label.match(/práctica (\\d+)$/);return m?Number(m[1]):null;};")
CARD = (ID_OF_CARD + "const cardText=(id)=>{const c=Array.from(document.querySelectorAll('ion-card'))"
        ".find(c=>idOfCard(c)===id);return c?c.innerText:null;};")
# Expresión completa (IIFE): pares [id_practica, texto] de todas las tarjetas visibles.
ALL_CARDS = ("(()=>{" + ID_OF_CARD + "return Array.from(document.querySelectorAll('ion-card'))"
             ".map(c=>{const id=idOfCard(c);return id===null?null:[id,c.innerText];}).filter(x=>x);})()")


def module11_dv(number):
    total, factor = 0, 2
    for digit in reversed(str(number)):
        total += int(digit) * factor
        factor = factor + 1 if factor < 7 else 2
    rest = 11 - total % 11
    return '0' if rest == 11 else 'K' if rest == 10 else str(rest)


STUDENT2_DV = module11_dv(STUDENT2_BODY)
# La aplicación guarda el RUT de estudiante normalizado (con puntos). La búsqueda del listado
# acepta solo el formato sin puntos y luego lo normaliza; por eso son dos formas distintas.
STUDENT2_RUT_STORED = f"{STUDENT2_BODY:,}".replace(',', '.') + f'-{STUDENT2_DV}'
STUDENT2_RUT_INPUT = f'{STUDENT2_BODY}-{STUDENT2_DV}'


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
    pg.name = 'ep06-e2e-hu017-' + pg.run_id
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
        for port in (8000, 4200):
            with socket.socket() as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(('127.0.0.1', port))
        pg.start()
        db = psycopg.connect(host=pg.host, port=5432, dbname='ep04_integration', user='postgres',
                             password=pg.admin_password, autocommit=True, connect_timeout=5,
                             passfile='/dev/null', sslmode='disable')

        def practice(state, student=100):
            return db.execute("""INSERT INTO practica(id_estudiante,id_centro,id_estado_actual)
                SELECT %s,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica""",
                (student, state)).fetchone()[0]

        # Orden de siembra (aprendido en HU016): históricos antes de EP06; prácticas y datos modernos después.
        extras = [practice('EN_CURSO') for _ in range(EXTRAS)]
        pa, pb, pc, pd, pe = (practice('EN_CURSO') for _ in range(5))
        legacy_ids = []
        for estado, cierre in LEGACY:
            legacy_ids.append(db.execute("""INSERT INTO incidencia(id_practica,id_usuario,descripcion,estado,fecha_resolucion)
                VALUES(%s,101,%s,%s,%s) RETURNING id_incidencia""",
                (pe, f'Histórico E2E HU017 {estado}', estado, cierre)).fetchone()[0])
        for path in sorted((ROOT / 'scripts/BD/fixes').glob('ep05-*.sql')):
            db.execute(path.read_text())
        for path in sorted((ROOT / 'scripts/BD/fixes').glob('ep06-*.sql')):
            db.execute(path.read_text())
        legacy_before = db.execute('SELECT to_jsonb(i) FROM incidencia i WHERE id_incidencia=ANY(%s) ORDER BY id_incidencia',
                                   (legacy_ids,)).fetchall()
        tipo = db.execute("SELECT id_tipo_incidencia FROM tipo_incidencia WHERE codigo='OTRO'").fetchone()[0]
        for index, identifier in enumerate(extras):
            db.execute("""INSERT INTO incidencia(id_practica,id_usuario,id_tipo_incidencia,fecha,descripcion,estado)
                VALUES(%s,101,%s,%s,'Pendiente sintética HU017','PENDIENTE')""",
                (identifier, tipo, f'2026-01-01T00:{index % 60:02d}:00+00:00'))
        db.execute("""INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash)
            VALUES(103,'Estudiante','Dos','student2@example.invalid','synthetic-hash')""")
        db.execute("INSERT INTO estudiante(id_estudiante,id_usuario,rut,carrera,sede) VALUES(101,103,%s,'Carrera sintetica','Sede sintetica')",
                   (STUDENT2_RUT_STORED,))
        # Práctica del estudiante 101: después de su fila en estudiante por la clave foránea.
        px = practice('EN_CURSO', student=101)
        db.execute("""INSERT INTO incidencia(id_practica,id_usuario,id_tipo_incidencia,fecha,descripcion,estado)
            VALUES(%s,101,%s,'2026-02-01T12:00:00+00:00','Pendiente de estudiante dos HU017','PENDIENTE')""", (px, tipo))
        credential = secrets.token_urlsafe(24)
        hashed = PasswordHash((BcryptHasher(),)).hash(credential)
        db.execute("UPDATE usuario SET password_hash=%s, correo=replace(correo,'example.invalid','example.com') "
                   "WHERE id_usuario IN(100,101,102,103)", (hashed,))
        logins = {'e2e_main': None, 'e2e_follow_write': 'pl_ep05_executor',
                  'e2e_follow_read': 'pl_ep05_read_executor', 'e2e_incidence': 'pl_ep06_executor'}
        passwords = {}
        for login_name, role in logins.items():
            passwords[login_name] = secrets.token_hex(24)
            db.execute(sql.SQL('CREATE ROLE {} LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD {}')
                       .format(sql.Identifier(login_name), sql.Literal(passwords[login_name])))
            if role:
                db.execute(sql.SQL('GRANT {} TO {}').format(sql.Identifier(role), sql.Identifier(login_name)))
        # Principal de laboratorio: lectura de prácticas y contexto; sin SELECT sobre incidencia.
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
            record('privilegios mínimos ' + login_name, privileges == (False, False, False), list(privileges), 'PostgreSQL')
        record('tres históricos sembrados antes de EP06', len(legacy_before) == 3, layer='PostgreSQL')

        temporary = tempfile.TemporaryDirectory(prefix='ep06-e2e-hu017-')
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
            uvicorn = spawn([sys.executable, '-B', '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000',
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

            # ---------- helpers de flujo: DOM y eventos normales del navegador ----------
            def login(session, email):
                session.go('/login')
                session.fill('ion-input[type=email] input', email)
                session.fill('ion-input[type=password] input', credential)
                session.click('Iniciar sesión')
                session.wait("location.pathname === '/home'")
                session.contains('Cerrar sesión')

            def logout(session):
                session.go('/home')
                session.click('Cerrar sesión')
                session.wait("location.pathname === '/login'")

            # Solo GET: Chromium registra también el preflight CORS (OPTIONS) de cada petición.
            def summary_requests(session):
                return [r for r in session.http if r['path'].startswith(SUMMARY) and r['method'] == 'GET']

            def listing_ready(session):
                session.go('/practicas')
                session.wait("location.pathname === '/practicas'")
                session.wait("!document.body.innerText.includes('Cargando prácticas')")
                session.wait("!document.body.innerText.includes('Cargando incidencias')")
                session.wait(f"({ALL_CARDS}).length > 0")

            def to_listing_via_home(session):
                # Camino real del gestor: el detalle no tiene control de retorno; Inicio -> Consultar prácticas
                # es una navegación SPA que monta de nuevo el listado.
                session.go('/home')
                session.click('Consultar prácticas')
                session.wait("location.pathname === '/practicas'")

            def wait_card(session, identifier, text):
                session.wait(f"(()=>{{{CARD} const t=cardText({identifier}); return t!==null && t.includes({json.dumps(text)});}})()")

            def card_values(session):
                cards = session.js(ALL_CARDS) or []
                values = {}
                for identifier, text in cards:
                    pendientes = re.search(r'Pendientes: (\d+)', text)
                    gestion = re.search(r'En gestión: (\d+)', text)
                    values[identifier] = (int(pendientes.group(1)) if pendientes else None,
                                          int(gestion.group(1)) if gestion else None)
                return values

            def verify_page(session, label):
                values = card_values(session)
                truth = db_counts(list(values))
                # Pendientes: debe coincidir en todas las tarjetas.
                pend_mismatch = [k for k, v in values.items() if v[0] != truth.get(k, (0, 0))[0]]
                record(f'pendientes {label} coinciden con PostgreSQL', len(values) > 0 and not pend_mismatch,
                       {'tarjetas': len(values), 'discrepancias': len(pend_mismatch)}, 'Chromium + PostgreSQL')
                # En gestión: estricto para todas las tarjetas, incluidas las solo EN_ATENCION (DEFECTO-001 cerrado).
                gestion_mismatch = [k for k, v in values.items() if v[1] != truth.get(k, (0, 0))[1]]
                record(f'en gestión {label} coincide con PostgreSQL en todas las tarjetas', not gestion_mismatch,
                       {'discrepancias': len(gestion_mismatch)}, 'Chromium + PostgreSQL')

            def db_counts(identifiers):
                if not identifiers:
                    return {}
                rows = db.execute("""SELECT p.id_practica,
                        count(i.id_incidencia) FILTER (WHERE i.estado='PENDIENTE'),
                        count(i.id_incidencia) FILTER (WHERE i.estado='EN_ATENCION')
                    FROM practica p LEFT JOIN incidencia i ON i.id_practica=p.id_practica
                    WHERE p.id_practica = ANY(%s) GROUP BY p.id_practica""", (identifiers,)).fetchall()
                return {row[0]: (row[1], row[2]) for row in rows}

            def open_incident(session, identifier, description):
                session.go(f'/practicas/{identifier}?vista=incidencias')
                session.wait('''document.querySelector('[aria-label="Paginación de incidencias"]') !== null''')
                session.wait("!document.body.innerText.includes('Cargando incidencias')")
                card = ("Array.from(document.querySelectorAll('article')).find(a=>a.innerText.includes(%s))"
                        % json.dumps(description))
                session.wait('!!(' + card + ' && ' + card + '.querySelector("ion-button"))')
                session.js('(' + card + ').querySelector("ion-button").click()')
                session.wait("document.body.innerText.includes('Historial de estados') && "
                             "!document.body.innerText.includes('Cargando historial de la incidencia')")

            def change_state(session, identifier, description, destino, comentario=None):
                open_incident(session, identifier, description)
                session.fill('#estado-destino', destino, 'change')
                if comentario is not None:
                    session.fill('#comentario-estado', comentario)
                before = len(session.http)
                session.click('Confirmar cambio')
                session.contains('Cambio de estado confirmado')
                return any(r['method'] == 'PATCH' and r['status'] == 200 for r in session.http[before:])

            def register(session, identifier, text):
                session.go(f'/practicas/{identifier}/incidencias/nueva')
                session.fill('#tipo-incidencia', 'SALUD', 'change')
                session.fill('#descripcion-incidencia', text)
                before = len(session.http)
                session.click('Guardar incidencia')
                session.contains('Incidencia registrada correctamente')
                return any(r['method'] == 'POST' and r['status'] == 201 for r in session.http[before:])

            def id_of(text):
                return db.execute('SELECT id_incidencia FROM incidencia WHERE descripcion=%s', (text,)).fetchone()[0]

            def incidence_state(identifier):
                return db.execute('SELECT estado FROM incidencia WHERE id_incidencia=%s', (identifier,)).fetchone()[0]

            def santiago(value):
                return value.astimezone(ZoneInfo('America/Santiago')).strftime('%d/%m/%Y, %H:%M')

            # Descripciones únicas para localizar cada incidencia en la interfaz.
            A1, A2, A3 = 'E2E-HU017 A pendiente 1', 'E2E-HU017 A pendiente 2', 'E2E-HU017 A en atención'
            A4 = 'E2E-HU017 A resuelta'
            B1, C1, D1 = 'E2E-HU017 B en atención', 'E2E-HU017 C resuelta', 'E2E-HU017 D finalizada pendiente'

            # ---------- 1. Siembra por interfaz y API (GESTOR) ----------
            login(browser, 'manager@example.com')
            record('login GESTOR mediante formulario')
            for text in (A1, A2, A3, A4):
                record('registro POST 201 ' + text[-24:], register(browser, pa, text))
            record('registro POST 201 ' + B1, register(browser, pb, B1))
            record('registro POST 201 ' + C1, register(browser, pc, C1))
            record('registro POST 201 ' + D1, register(browser, pd, D1))
            # Estados A/B/C por API real desde Chromium; mismas rutas que usa la interfaz.
            a3, a4 = id_of(A3), id_of(A4)
            r = browser.api('PATCH', f'/practicas/{pa}/incidencias/{a3}/estado',
                            {'estado_esperado': 'PENDIENTE', 'estado_nuevo': 'EN_ATENCION', 'comentario': None})
            record('A: PENDIENTE->EN_ATENCION por API', r['status'] == 200, r['status'], 'API real (fetch)')
            r = browser.api('PATCH', f'/practicas/{pa}/incidencias/{a4}/estado',
                            {'estado_esperado': 'PENDIENTE', 'estado_nuevo': 'RESUELTA', 'comentario': 'Resuelta E2E'})
            record('A: PENDIENTE->RESUELTA por API', r['status'] == 200, r['status'], 'API real (fetch)')
            r = browser.api('PATCH', f'/practicas/{pb}/incidencias/{id_of(B1)}/estado',
                            {'estado_esperado': 'PENDIENTE', 'estado_nuevo': 'EN_ATENCION', 'comentario': None})
            record('B: PENDIENTE->EN_ATENCION por API', r['status'] == 200, r['status'], 'API real (fetch)')
            r = browser.api('PATCH', f'/practicas/{pc}/incidencias/{id_of(C1)}/estado',
                            {'estado_esperado': 'PENDIENTE', 'estado_nuevo': 'RESUELTA', 'comentario': 'Resuelta C E2E'})
            record('C: PENDIENTE->RESUELTA por API', r['status'] == 200, r['status'], 'API real (fetch)')
            # D: finalizada con pendiente moderna. La finalización es fixture SQL de laboratorio.
            db.execute("UPDATE practica SET id_estado_actual=(SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA') "
                       "WHERE id_practica=%s", (pd,))
            record('práctica D finalizada por fixture de laboratorio', True, layer='PostgreSQL')

            # ---------- 2. Listado: resumen, sin N+1 y coincidencia por id ----------
            before_listing = len(browser.http)
            listing_ready(browser)
            requests_listing = [r for r in browser.http[before_listing:] if r['path'].startswith('/practicas')]
            summary_paths = [r['path'] for r in requests_listing
                             if r['path'].startswith(SUMMARY) and r['method'] == 'GET']
            record('resumen solicitado en páginas de 100 (offset 0 y 100)',
                   summary_paths == [f'{SUMMARY}?limit=100&offset=0', f'{SUMMARY}?limit=100&offset=100'], summary_paths,
                   'API real (fetch)')
            # Detalle = /practicas/{id}... distinto del resumen; el resumen también empieza por /practicas/.
            detalle = [r['path'] for r in requests_listing
                       if r['path'].startswith('/practicas/') and not r['path'].startswith(SUMMARY)]
            record('sin petición de detalle por práctica durante el listado', not detalle, detalle[:3])
            wait_card(browser, pa, 'Pendientes: 2')
            record('práctica A muestra Pendientes: 2 y En gestión: 1',
                   card_values(browser).get(pa) == (2, 1), card_values(browser).get(pa))
            values = card_values(browser)
            record('práctica B: EN_ATENCION no cuenta como pendiente', values.get(pb)[0] == 0, values.get(pb))
            # DEFECTO-001 (corregido por ep06-09): B solo tiene EN_ATENCION y debe mostrar En gestión 1.
            record('DEFECTO-001 cerrado: práctica B solo EN_ATENCION muestra En gestión 1',
                   values.get(pb) == (0, 1), values.get(pb))
            # Contenido del resumen por API real: B aparece con pendientes 0, en gestión 1 y fecha null;
            # C (solo RESUELTA) y E (solo históricos) no aparecen.
            resumen_items = []
            for offset in (0, 100, 200):
                pagina = browser.api('GET', f'{SUMMARY}?limit=100&offset={offset}')
                resumen_items.extend(pagina['body']['items'])
                if not pagina['body']['hay_mas']:
                    break
            por_id = {item['id_practica']: item for item in resumen_items}
            record('resumen API: B con pendientes 0, en gestión 1 y fecha null',
                   por_id.get(pb) == {'id_practica': pb, 'pendientes': 0, 'en_atencion': 1,
                                      'fecha_pendiente_antigua': None}, por_id.get(pb), 'API real (fetch)')
            record('resumen API: C (solo RESUELTA) y E (solo históricos) ausentes',
                   pc not in por_id and pe not in por_id, 'API real (fetch)')
            record('práctica C: solo RESUELTA no aparece como pendiente', values.get(pc) == (0, 0), values.get(pc))
            record('práctica D finalizada conserva Pendientes: 1', values.get(pd) == (1, 0), values.get(pd))
            record('práctica E con históricos incompatibles no cuenta', values.get(pe) == (0, 0), values.get(pe))
            record('práctica X de otro estudiante con 1 pendiente', values.get(px) == (1, 0), values.get(px))
            verify_page(browser, 'página 1')
            d_fecha = db.execute("SELECT min(fecha) FROM incidencia WHERE id_practica=%s AND estado='PENDIENTE'", (pd,)).fetchone()[0]
            texto_d = browser.js(f"(()=>{{{CARD} return cardText({pd});}})()") or ''
            record('fecha pendiente desde de D en America/Santiago',
                   f'Pendiente desde {santiago(d_fecha)}' in texto_d, santiago(d_fecha), 'Chromium + PostgreSQL')

            # ---------- 3. Búsqueda por RUT ----------
            before_search = len(summary_requests(browser))
            browser.fill('#rut-busqueda', STUDENT2_RUT_INPUT)
            browser.click('Buscar')
            browser.wait(f"({ALL_CARDS}).length === 1")
            wait_card(browser, px, 'Pendientes: 1')
            record('búsqueda por RUT conserva el resumen correcto de la práctica filtrada',
                   list(card_values(browser)) == [px] and card_values(browser)[px] == (1, 0), card_values(browser))
            record('búsqueda por RUT no vuelve a pedir el resumen', len(summary_requests(browser)) == before_search)
            browser.click('Limpiar filtro')
            wait_card(browser, pa, 'Pendientes: 2')
            record('limpiar búsqueda restaura indicadores', card_values(browser).get(pa) == (2, 1))
            record('limpiar búsqueda no vuelve a pedir el resumen', len(summary_requests(browser)) == before_search)

            # ---------- 4. Cambio de página ----------
            before_page = len(summary_requests(browser))
            browser.js("(()=>{const nav=document.querySelector('nav[aria-label=\"Paginación\"]');"
                       "nav.querySelectorAll('ion-button')[1].click();})()")
            browser.wait("document.body.innerText.includes('Página 2')")
            browser.wait("!document.body.innerText.includes('Cargando prácticas')")
            verify_page(browser, 'página 2')
            record('cambio de página no vuelve a pedir el resumen', len(summary_requests(browser)) == before_page)
            browser.js("(()=>{const nav=document.querySelector('nav[aria-label=\"Paginación\"]');"
                       "nav.querySelectorAll('ion-button')[0].click();})()")
            browser.wait("document.body.innerText.includes('Página 1')")

            # ---------- 5. HU016 → HU017: cambio de estado y actualización ----------
            a1 = id_of(A1)
            record('A1 cambia PENDIENTE->EN_ATENCION por interfaz HU016',
                   change_state(browser, pa, A1, 'EN_ATENCION', '  Revisión E2E HU017  '))
            record('estado en PostgreSQL tras HU016', incidence_state(a1) == 'EN_ATENCION', layer='PostgreSQL')
            before_back = len(summary_requests(browser))
            to_listing_via_home(browser)
            wait_card(browser, pa, 'Pendientes: 1')
            record('volver al listado muestra Pendientes: 1 y En gestión: 2',
                   card_values(browser).get(pa) == (1, 2), card_values(browser).get(pa))
            evidence['volver_listado_solicitudes_resumen'] = len(summary_requests(browser)) - before_back
            record('volver al listado vuelve a solicitar el resumen (nuevo montaje)',
                   len(summary_requests(browser)) - before_back == 2, len(summary_requests(browser)) - before_back)
            verify_page(browser, 'tras HU016 PENDIENTE->EN_ATENCION')
            record('EN_ATENCION->RESUELTA por interfaz HU016',
                   change_state(browser, pa, A1, 'RESUELTA', 'Resuelta E2E HU017'))
            to_listing_via_home(browser)
            wait_card(browser, pa, 'En gestión: 1')
            record('tras EN_ATENCION->RESUELTA: A deja de contar la resuelta como pendiente ni en gestión',
                   card_values(browser).get(pa) == (1, 1), card_values(browser).get(pa))
            verify_page(browser, 'tras HU016 EN_ATENCION->RESUELTA')

            # ---------- 6. Recarga completa ----------
            browser.call('Page.reload')
            browser.wait("!document.body.innerText.includes('Cargando incidencias')")
            wait_card(browser, pa, 'Pendientes: 1')
            verify_page(browser, 'tras recarga completa')
            record('recarga reconstruye contadores desde PostgreSQL')

            # ---------- 7. Error y reintento sin ceros falsos ----------
            db.execute('REVOKE EXECUTE ON FUNCTION incidencias_privadas.fn_resumen_incidencias_pendientes(BIGINT,INTEGER,BIGINT) FROM pl_ep06_executor')
            try:
                listing_ready(browser)
                browser.wait("document.body.innerText.includes('Incidencias no disponibles')")
                record('error del resumen: el listado sigue visible con sus tarjetas',
                       card_values(browser).get(pa) == (None, None)
                       and browser.js(f"(()=>{{{CARD} return cardText({pa}) !== null;}})()"))
                record('error del resumen: mensaje visible y sin ceros falsos',
                       not browser.js("document.body.innerText.includes('Pendientes: ')")
                       and browser.js("document.body.innerText.includes('No fue posible cargar las incidencias pendientes')"))
                record('error del resumen: respuesta HTTP 500 saneada',
                       summary_requests(browser)[-1]['status'] == 500, summary_requests(browser)[-1]['status'],
                       'API real (fetch)')
            finally:
                db.execute('GRANT EXECUTE ON FUNCTION incidencias_privadas.fn_resumen_incidencias_pendientes(BIGINT,INTEGER,BIGINT) TO pl_ep06_executor')
            browser.click('Reintentar incidencias')
            wait_card(browser, pa, 'Pendientes: 1')
            verify_page(browser, 'tras reintento')
            record('reintento manual recupera el resumen real', card_values(browser).get(pa) == (1, 1))

            # ---------- 8. Permisos: ADMINISTRADOR, ESTUDIANTE, usuario inactivo ----------
            logout(browser)
            login(browser, 'admin@example.com')
            listing_ready(browser)
            wait_card(browser, pa, 'Pendientes: 1')
            verify_page(browser, 'vista ADMINISTRADOR')
            record('ADMINISTRADOR consulta y visualiza el resumen', card_values(browser).get(pa) == (1, 1))
            logout(browser)
            login(browser, 'student@example.com')
            before_student = len(summary_requests(browser))
            browser.go('/practicas')
            browser.wait("location.pathname === '/home'")
            record('ESTUDIANTE redirigido desde /practicas', True)
            record('ESTUDIANTE: Angular no solicita el resumen', len(summary_requests(browser)) == before_student)
            r = browser.api('GET', f'{SUMMARY}?limit=100&offset=0')
            record('ESTUDIANTE: llamada directa al resumen devuelve 403', r['status'] == 403, r['status'], 'API real (fetch)')
            logout(browser)
            login(browser, 'manager@example.com')

            # ---------- 9. Regresiones HU015, HU016, HU013, HU014 ----------
            e1 = 'E2E-HU017 regresion HU015'
            record('regresión HU015: registro POST 201 en práctica E', register(browser, pe, e1))
            listing_ready(browser)
            wait_card(browser, pe, 'Pendientes: 1')
            verify_page(browser, 'tras registro HU015')
            open_incident(browser, pe, e1)
            browser.contains(e1)  # lanza AssertionError si la incidencia persistida no aparece
            record('regresión HU015: incidencia persistida visible en su práctica')
            a2 = id_of(A2)
            record('regresión HU016: cambio y historial visibles', change_state(browser, pa, A2, 'EN_ATENCION'))
            open_incident(browser, pa, A2)
            browser.contains('PENDIENTE → EN_ATENCION')
            record('regresión HU016: historial consultado en navegador')
            browser.go(f'/practicas/{pa}/seguimiento/nuevo')
            browser.fill('#tipo-contacto', 'Videollamada', 'change')
            browser.fill('#observaciones', 'Seguimiento regresión HU017')
            browser.click('Guardar seguimiento')
            browser.contains('Seguimiento registrado correctamente')
            browser.click('Volver al detalle')
            record('regresión HU013: seguimiento registrado y visible', True)
            record('regresión HU013 persistida en PostgreSQL', db.execute(
                'SELECT count(*) FROM seguimiento WHERE id_practica=%s AND observacion=%s',
                (pa, 'Seguimiento regresión HU017')).fetchone()[0] == 1, layer='PostgreSQL')
            listing_ready(browser)
            # A sin pendientes pero con 2 EN_ATENCION: sigue en el resumen con En gestión real (2).
            wait_card(browser, pa, 'En gestión: 2')
            verify_page(browser, 'tras regresiones')

            # ---------- 10. Históricos y seguridad PostgreSQL ----------
            legacy_after = db.execute('SELECT to_jsonb(i) FROM incidencia i WHERE id_incidencia=ANY(%s) ORDER BY id_incidencia',
                                      (legacy_ids,)).fetchall()
            record('históricos ABIERTA/EN_REVISION/CERRADA intactos tras HU017', legacy_after == legacy_before,
                   layer='PostgreSQL')
            record('históricos no cuentan en la vista de E', card_values(browser).get(pe) == (1, 0),
                   card_values(browser).get(pe))
            direct = db.execute("SELECT has_table_privilege('e2e_incidence','public.incidencia','SELECT,INSERT,UPDATE,DELETE')").fetchone()[0]
            record('ejecutor sin SELECT/DML directo sobre incidencia', direct is False, layer='PostgreSQL')
            can_execute = db.execute("SELECT has_function_privilege('e2e_incidence','incidencias_privadas.fn_resumen_incidencias_pendientes(bigint,integer,bigint)','EXECUTE')").fetchone()[0]
            record('ejecutor con EXECUTE sobre el resumen', can_execute is True, layer='PostgreSQL')
            rls = db.execute("SELECT relrowsecurity FROM pg_class WHERE oid='public.incidencia'::regclass").fetchone()[0]
            record('RLS activo sobre incidencia', rls is True, layer='PostgreSQL')
            before_summary_db = db.execute('SELECT to_jsonb(i) FROM incidencia i ORDER BY id_incidencia').fetchall()
            browser.api('GET', f'{SUMMARY}?limit=100&offset=0')
            record('el resumen no modifica filas (sin DML)',
                   db.execute('SELECT to_jsonb(i) FROM incidencia i ORDER BY id_incidencia').fetchall() == before_summary_db,
                   layer='PostgreSQL')

            # ---------- 11. Usuario inactivo ----------
            logout(browser)
            login(browser, 'manager@example.com')
            db.execute('UPDATE usuario SET activo=false WHERE id_usuario=101')
            r = browser.api('GET', f'{SUMMARY}?limit=100&offset=0')
            record('usuario inactivo con JWT previo: resumen devuelve 403', r['status'] == 403, r['status'],
                   'API real (fetch)')
            record('usuario inactivo: respuesta sin datos de resumen', 'items' not in r['body'])
            browser.go('/home')
            browser.wait("location.pathname === '/login'")
            record('usuario inactivo expulsado de la interfaz')
            db.execute('UPDATE usuario SET activo=true WHERE id_usuario=101')

            # ---------- 12. Evidencia final ----------
            record('sin accesos localStorage durante la ejecución', all(s.storage_accesses == [] for s in browsers),
                   [len(s.storage_accesses) for s in browsers])
            evidence['http_browser'] = [dict(sesion=s.name, method=e['method'], path=e['path'], status=e['status'])
                                        for s in browsers for e in s.http]
            evidence['resumen_solicitudes_get'] = len([e for s in browsers for e in s.http
                                                       if e['path'].startswith(SUMMARY) and e['method'] == 'GET'])
            for session in browsers:
                session.close()
            browsers.clear()
    except Exception as error:
        evidence['failure'] = {'type': type(error).__name__,
                               'reason': str(error) if isinstance(error, (AssertionError, RuntimeError))
                               else 'Error interno del laboratorio; sin detalles sensibles'}
        print('E2E interrumpido:', evidence['failure'], flush=True)
        try:
            if browsers:
                evidence['http_browser'] = [dict(sesion=s.name, method=e['method'], path=e['path'], status=e['status'])
                                            for s in browsers for e in s.http]
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
