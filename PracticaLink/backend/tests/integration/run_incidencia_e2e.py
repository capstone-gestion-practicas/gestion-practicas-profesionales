"""Chromium real -> Angular -> Uvicorn -> PostgreSQL 18.6; sin mocks ni .env."""
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
import urllib.request

from run_inicio_practica import LocalPostgres, ROOT, docker

BACKEND = ROOT / 'PracticaLink/backend'
FRONTEND = ROOT / 'PracticaLink/frontend'


class Browser:
    """Cliente CDP síncrono. Solo conserva URL/método/status, nunca headers/body."""
    def __init__(self, url):
        from websockets.sync.client import connect
        self.context = connect(url, max_size=8 * 1024 * 1024, proxy=None)
        self.ws = self.context.__enter__()
        self.counter = 0
        self.requests = {}
        self.http = []
        self.errors = []
        self.storage_accesses = []
        self.call('Page.enable')
        self.call('Runtime.enable')
        self.call('Network.enable')
        self.call('Runtime.addBinding', {'name': '__e2eStorageAccess'})
        self.call('Network.setBlockedURLs', {'urls': ['https://*']})
        self.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
            window.__localAccess = [];
            for (const name of ['getItem','setItem','removeItem','clear']) {
              const original = Storage.prototype[name];
              Storage.prototype[name] = function(...args) {
                if (this === localStorage) {
                  const access = {operation:name,key:args[0]??null};
                  window.__localAccess.push(access);
                  window.__e2eStorageAccess(JSON.stringify(access));
                }
                return original.apply(this,args);
              };
            }
        """})

    def event(self, message):
        p = message.get('params', {})
        if message.get('method') == 'Runtime.bindingCalled' and p.get('name') == '__e2eStorageAccess':
            self.storage_accesses.append(json.loads(p['payload']))
        if message.get('method') == 'Runtime.exceptionThrown':
            self.errors.append(p.get('exceptionDetails', {}).get('text', 'Browser exception'))
        if message.get('method') == 'Network.requestWillBeSent':
            request = p['request']
            url = request['url']
            if url.startswith('http://127.0.0.1:8000/'):
                self.requests[p['requestId']] = (request['method'], url.split(':8000', 1)[1])
        if message.get('method') == 'Network.responseReceived' and p['requestId'] in self.requests:
            method, path = self.requests.pop(p['requestId'])
            self.http.append({'method': method, 'path': path, 'status': p['response']['status']})

    def call(self, method, params=None):
        self.counter += 1
        ident = self.counter
        self.ws.send(json.dumps({'id': ident, 'method': method, 'params': params or {}}))
        while True:
            message = json.loads(self.ws.recv(timeout=30))
            self.event(message)
            if message.get('id') == ident:
                if 'error' in message:
                    raise RuntimeError('CDP command failed: ' + method)
                return message.get('result', {})

    def js(self, expression):
        result = self.call('Runtime.evaluate', {
            'expression': expression, 'returnByValue': True, 'awaitPromise': True
        })
        if 'exceptionDetails' in result:
            raise RuntimeError('Browser JavaScript failed')
        return result.get('result', {}).get('value')

    def wait(self, expression, seconds=20):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.js(expression):
                return
            time.sleep(.1)
        raise AssertionError('Browser condition timed out: ' + expression[:180])

    def go(self, path):
        self.call('Page.navigate', {'url': 'http://127.0.0.1:4200' + path})
        self.wait("document.readyState === 'complete' && !!document.querySelector('app-root')")
        time.sleep(.3)

    def fill(self, selector, value, event='input'):
        self.wait('!!document.querySelector(' + json.dumps(selector) + ')')
        self.js("""(() => {const el=document.querySelector(%s); el.value=%s;
            el.dispatchEvent(new Event(%s,{bubbles:true}));})()""" %
            (json.dumps(selector), json.dumps(value), json.dumps(event)))

    def click(self, text):
        expression = """Array.from(document.querySelectorAll('button,ion-button'))
            .find(e=>e.textContent.trim()===%s)""" % json.dumps(text)
        self.wait('!!(' + expression + ')')
        self.js('(' + expression + ').click()')

    def contains(self, text):
        self.wait('document.body.innerText.toLocaleLowerCase().includes(' + json.dumps(text.lower()) + ')')

    def local_access(self):
        return self.js('window.__localAccess || []')

    def api(self, method, path, body=None):
        # Fetch real desde Chromium; no interceptor ni sustitución de respuesta.
        return self.js("""(async()=>{const r=await fetch('http://127.0.0.1:8000'+%s,{
            method:%s,headers:{'Content-Type':'application/json',
            Authorization:'Bearer '+sessionStorage.getItem('access_token')},
            %s});return {status:r.status,body:await r.json()};})()""" %
            (json.dumps(path), json.dumps(method),
             'body:JSON.stringify(' + json.dumps(body) + ')' if body is not None else ''))

    def close(self):
        self.context.__exit__(None, None, None)


def wait_url(url, processes, seconds=90):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if any(p.poll() is not None for p in processes):
            raise RuntimeError('Temporary server exited before readiness')
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return json.load(response) if '/json/' in url else response.status
        except Exception:
            time.sleep(.2)
    raise RuntimeError('Temporary server readiness timeout')


def run(report):
    import psycopg
    from psycopg import sql
    from pwdlib import PasswordHash
    from pwdlib.hashers.bcrypt import BcryptHasher
    from sqlalchemy.engine import URL
    from zoneinfo import ZoneInfo

    evidence = {'head': subprocess.check_output(['git','rev-parse','--short','HEAD'], cwd=ROOT, text=True).strip(),
                'checks': [], 'http_browser': [], 'cleanup': False}
    pg = LocalPostgres('postgres:18.6')
    pg.name = 'ep06-e2e-' + pg.run_id
    pg.network = pg.name + '-net'
    pg.volume = pg.name + '-data'
    processes = []
    browser = None
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

    try:
        # URLs de la aplicación son fijas; no ocupar ni detener servicios existentes.
        for port in (8000, 4200):
            with socket.socket() as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(('127.0.0.1', port))
        pg.start()
        db = psycopg.connect(host=pg.host, port=5432, dbname='ep04_integration',
                            user='postgres', password=pg.admin_password, autocommit=True,
                            connect_timeout=5, passfile='/dev/null', sslmode='disable')
        def practice(state):
            return db.execute("""INSERT INTO practica(id_estudiante,id_centro,id_estado_actual)
                SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica""",
                (state,)).fetchone()[0]
        a, b, final = practice('EN_CURSO'), practice('EN_CURSO'), practice('FINALIZADA')
        old_description = 'Histórico E2E ' + 'x' * 2100
        old_id = db.execute("""INSERT INTO incidencia(id_practica,id_usuario,descripcion,estado,fecha_resolucion)
            VALUES(%s,101,%s,'CERRADA','2026-01-02T12:00:00Z') RETURNING id_incidencia""",
            (final, old_description)).fetchone()[0]
        for path in sorted((ROOT/'scripts/BD/fixes').glob('ep05-*.sql')):
            db.execute(path.read_text())
        for path in sorted((ROOT/'scripts/BD/fixes').glob('ep06-*.sql')):
            db.execute(path.read_text())
        legacy = db.execute('SELECT to_jsonb(i) FROM incidencia i WHERE id_incidencia=%s',(old_id,)).fetchone()[0]
        credential = secrets.token_urlsafe(24)
        hashed = PasswordHash((BcryptHasher(),)).hash(credential)
        db.execute("UPDATE usuario SET password_hash=%s, correo=replace(correo,'example.invalid','example.com') WHERE id_usuario IN(100,101,102)",(hashed,))
        # Sintético, sin acceso a incidencias/seguimientos ni pertenencia a ejecutores.
        logins = {'e2e_main': None, 'e2e_follow_write': 'pl_ep05_executor',
                  'e2e_follow_read': 'pl_ep05_read_executor', 'e2e_incidence': 'pl_ep06_executor'}
        passwords = {}
        for login, role in logins.items():
            passwords[login] = secrets.token_hex(24)
            db.execute(sql.SQL('CREATE ROLE {} LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD {}')
                       .format(sql.Identifier(login), sql.Literal(passwords[login])))
            if role:
                db.execute(sql.SQL('GRANT {} TO {}').format(sql.Identifier(role),sql.Identifier(login)))
        for table in ('usuario','rol','usuario_rol','estudiante','practica','estado_practica','centro_practica','historial_estado'):
            db.execute(sql.SQL('GRANT SELECT ON public.{} TO e2e_main').format(sql.Identifier(table)))
            db.execute(sql.SQL('CREATE POLICY e2e_main_read ON public.{} FOR SELECT TO e2e_main USING(true)')
                       .format(sql.Identifier(table)))
        db.execute('GRANT USAGE ON SCHEMA public TO e2e_main')
        for login, table in [('e2e_incidence','incidencia'),('e2e_follow_read','seguimiento'),('e2e_follow_write','seguimiento'),('e2e_main','incidencia')]:
            privileges = db.execute("""SELECT has_table_privilege(%s,%s,'SELECT'),
                has_table_privilege(%s,%s,'INSERT'),has_table_privilege(%s,%s,'DELETE')""",
                (login,table,login,table,login,table)).fetchone()
            record('privilegios mínimos ' + login, privileges == (False,False,False),
                   list(privileges), 'PostgreSQL')
        temporary = tempfile.TemporaryDirectory(prefix='ep06-e2e-')
        with nullcontext(temporary.name) as temp:
            env = {k:v for k,v in os.environ.items() if not any(
                word in k.upper() for word in ('DATABASE','SUPABASE','JWT','CHILE_RUT','PGPASSWORD','PGSERVICE'))}
            def url(login):
                return URL.create('postgresql+psycopg', username=login, password=passwords[login],
                                  host=pg.host, port=5432, database='ep04_integration').render_as_string(hide_password=False)
            env.update(SUPABASE_DATABASE_URL=url('e2e_main'), INCIDENCIAS_DATABASE_URL=url('e2e_incidence'),
                       SEGUIMIENTOS_DATABASE_URL=url('e2e_follow_write'),
                       SEGUIMIENTOS_LECTURA_DATABASE_URL=url('e2e_follow_read'),
                       JWT_SECRET_KEY=secrets.token_hex(32), PYTHONPATH=str(BACKEND), PYTHONDONTWRITEBYTECODE='1')
            # cwd efímero vacío: Settings no encuentra el .env real.
            spawn([sys.executable,'-B','-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000',
                   '--no-access-log','--log-level','critical'], temp, env)
            wait_url('http://127.0.0.1:8000/', processes)
            spawn(['node',str(FRONTEND/'node_modules/@angular/cli/bin/ng.js'),'serve',
                   '--host','127.0.0.1','--port','4200'], FRONTEND, {**os.environ,'NG_CLI_ANALYTICS':'false'})
            wait_url('http://127.0.0.1:4200/', processes)
            chrome = spawn([shutil.which('chromium'),'--headless','--disable-gpu','--disable-dev-shm-usage',
                '--no-first-run','--disable-background-networking','--disable-sync',
                '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
                '--user-data-dir='+temp+'/chrome','about:blank'], temp, os.environ.copy())
            active = Path(temp)/'chrome/DevToolsActivePort'
            end = time.monotonic()+20
            while not active.exists() and time.monotonic()<end and chrome.poll() is None:
                time.sleep(.1)
            if not active.exists():
                raise RuntimeError('Chromium did not expose CDP')
            port = active.read_text().splitlines()[0]
            targets = wait_url('http://127.0.0.1:'+port+'/json/list', processes)
            browser = Browser(next(t['webSocketDebuggerUrl'] for t in targets if t['type']=='page'))
            evidence['browser'] = browser.call('Browser.getVersion')['product']
            def no_local():
                record('sin acceso localStorage en página', browser.local_access()==[], browser.local_access())
            def login(email):
                browser.go('/login')
                browser.fill('ion-input[type=email] input',email)
                browser.fill('ion-input[type=password] input',credential)
                browser.click('Iniciar sesión')
                browser.wait("location.pathname === '/home'")
                browser.contains('Cerrar sesión')
            def logout():
                browser.go('/home')
                browser.click('Cerrar sesión')
                browser.wait("location.pathname === '/login'")
            def history(identifier):
                browser.go('/practicas/'+str(identifier)+'?vista=incidencias')
                browser.wait('''document.querySelector('[aria-label="Paginación de incidencias"]') !== null''')
                browser.wait("!document.body.innerText.includes('Cargando incidencias')")
            def register(identifier, text):
                browser.go('/practicas/'+str(identifier)+'/incidencias/nueva')
                browser.fill('#tipo-incidencia','SALUD','change')
                browser.fill('#descripcion-incidencia',text)
                before=len(browser.http)
                browser.click('Guardar incidencia')
                browser.contains('Incidencia registrada correctamente')
                record('POST 201 desde formulario', any(r['method']=='POST' and r['status']==201
                    and r['path']==f'/practicas/{identifier}/incidencias' for r in browser.http[before:]))
                browser.contains('PENDIENTE')
                no_local()
            login('manager@example.com')
            record('login GESTOR mediante formulario')
            register(a,'Incidencia E2E gestor')
            row = db.execute('SELECT id_incidencia,id_practica,id_usuario,estado,fecha FROM incidencia WHERE id_practica=%s',(a,)).fetchone()
            record('incidencia confirmada con práctica y autor',row[1:4]==(a,101,'PENDIENTE'),
                   {'id_incidencia':row[0],'id_practica':row[1],'id_usuario':row[2],'estado':row[3]},'PostgreSQL')
            expected=row[4].astimezone(ZoneInfo('America/Santiago')).strftime('%d/%m/%Y, %H:%M')
            record('fecha PostgreSQL presentada America/Santiago',browser.js("document.querySelector('time').textContent")==expected,expected)
            event=db.execute('SELECT id_usuario,estado_anterior,estado_nuevo,fecha FROM historial_estado_incidencia WHERE id_incidencia=%s',(row[0],)).fetchall()
            record('evento inicial atómico',event==[(101,None,'PENDIENTE',row[4])],layer='PostgreSQL')
            browser.click('Volver al detalle')
            browser.contains('Incidencia E2E gestor')
            record('GET real al volver al detalle',any(r['method']=='GET' and r['status']==200 and r['path'].startswith(f'/practicas/{a}/incidencias?') for r in browser.http))
            no_local()
            browser.call('Page.reload')
            browser.contains('Incidencia E2E gestor')
            record('persistencia tras recarga')
            logout()
            login('manager@example.com')
            history(a)
            browser.contains('Incidencia E2E gestor')
            record('persistencia tras cerrar y abrir sesión')
            history(b)
            browser.contains('No hay incidencias registradas para esta práctica')
            record('separación y lista vacía B',not browser.js("document.body.innerText.includes('Incidencia E2E gestor')"))
            # Navegación real SPA por popstate; sin cambiar respuesta ni latencia HTTP.
            browser.js(f"history.pushState(null,'','/practicas/{a}?vista=incidencias');dispatchEvent(new PopStateEvent('popstate'));")
            browser.js(f"history.pushState(null,'','/practicas/{b}?vista=incidencias');dispatchEvent(new PopStateEvent('popstate'));")
            browser.contains('No hay incidencias registradas para esta práctica')
            time.sleep(.5)
            record('navegación rápida A/B sin mezcla',not browser.js("document.body.innerText.includes('Incidencia E2E gestor')"))
            no_local()
            history(final)
            for text in ('Sin tipo registrado','CERRADA',old_description,'Fecha de resolución:'):
                browser.contains(text)
            record('históricos finalizados y descripción extensa',not browser.js("document.body.innerText.includes('Responsable de resolución:') || document.body.innerText.includes('Comentario:')"))
            record('histórico intacto',legacy==db.execute('SELECT to_jsonb(i) FROM incidencia i WHERE id_incidencia=%s',(old_id,)).fetchone()[0],layer='PostgreSQL')
            browser.go(f'/practicas/{final}/incidencias/nueva')
            browser.contains('Solo se pueden registrar incidencias en prácticas EN_CURSO.')
            record('alta finalizada bloqueada en interfaz',browser.js("document.querySelector('ion-button[type=submit]').disabled"))
            r=browser.api('POST',f'/practicas/{final}/incidencias',{'tipo':'SALUD','descripcion':'No insertar'})
            record('alta finalizada rechazada API',r['status']==409,r['status'],'API real (fetch)')
            # Dos eventos submit en el mismo turno: ejercicio más agresivo que dos clics.
            browser.go(f'/practicas/{b}/incidencias/nueva')
            browser.fill('#tipo-incidencia','SALUD','change')
            browser.fill('#descripcion-incidencia','Doble envío E2E')
            before=db.execute('SELECT count(*) FROM incidencia WHERE id_practica=%s',(b,)).fetchone()[0]
            browser.js("const f=document.querySelector('form'); f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));")
            browser.contains('Incidencia registrada correctamente')
            time.sleep(.3)
            record('doble envío: una sola fila',db.execute('SELECT count(*) FROM incidencia WHERE id_practica=%s',(b,)).fetchone()[0]==before+1,layer='Chromium + PostgreSQL')
            # HU013 / HU014 por interfaz y función SQL reales.
            browser.go(f'/practicas/{a}/seguimiento/nuevo')
            browser.fill('#tipo-contacto','Videollamada','change')
            browser.fill('#observaciones','Seguimiento regresión E2E')
            browser.click('Guardar seguimiento')
            browser.contains('Seguimiento registrado correctamente')
            browser.click('Volver al detalle')
            browser.contains('Seguimiento regresión E2E')
            record('regresión HU013/HU014 en navegador')
            record('seguimiento en PostgreSQL',db.execute('SELECT count(*) FROM seguimiento WHERE id_practica=%s AND id_usuario=101 AND observacion=%s',(a,'Seguimiento regresión E2E')).fetchone()[0]==1,layer='PostgreSQL')
            logout()
            login('admin@example.com')
            register(a,'Incidencia E2E administrador')
            browser.click('Volver al detalle')
            browser.contains('Incidencia E2E administrador')
            browser.contains('Incidencia E2E gestor')
            record('ADMINISTRADOR registra y consulta')
            logout()
            login('student@example.com')
            for suffix in ('?vista=incidencias','/incidencias/nueva'):
                browser.go(f'/practicas/{a}'+suffix)
                browser.wait("location.pathname === '/home'")
                record('ESTUDIANTE bloqueado interfaz '+suffix)
            for method in ('GET','POST'):
                r=browser.api(method,f'/practicas/{a}/incidencias',{'tipo':'SALUD','descripcion':'No insertar'} if method=='POST' else None)
                record('ESTUDIANTE rechazado '+method,r['status']==403,r['status'],'API real (fetch)')
            logout()
            login('manager@example.com')
            db.execute('UPDATE usuario SET activo=false WHERE id_usuario=101')
            for method in ('GET','POST'):
                r=browser.api(method,f'/practicas/{a}/incidencias',{'tipo':'SALUD','descripcion':'No insertar'} if method=='POST' else None)
                record('usuario inactivo con JWT previo '+method,r['status']==403,r['status'],'API real (fetch)')
            # Home vuelve a login automáticamente al rechazar el contexto inactivo.
            browser.go('/home')
            browser.wait("location.pathname === '/login'")
            record('usuario inactivo expulsado de interfaz')
            browser.fill('ion-input[type=email] input','manager@example.com')
            browser.fill('ion-input[type=password] input',credential)
            browser.click('Iniciar sesión')
            browser.contains('Correo o contraseña incorrectos.')
            record('login inactivo rechazado',browser.js("location.pathname === '/login'"))
            record('sin accesos localStorage durante toda la ejecución', browser.storage_accesses == [],
                   browser.storage_accesses)
            evidence['http_browser']=browser.http
            evidence['database_summary'] = {
                'incidencias_A': db.execute('SELECT count(*) FROM incidencia WHERE id_practica=%s',(a,)).fetchone()[0],
                'incidencias_B': db.execute('SELECT count(*) FROM incidencia WHERE id_practica=%s',(b,)).fetchone()[0],
                'historicos': db.execute('SELECT count(*) FROM incidencia WHERE id_practica=%s',(final,)).fetchone()[0],
                'eventos_iniciales': db.execute("SELECT count(*) FROM historial_estado_incidencia WHERE estado_anterior IS NULL AND estado_nuevo='PENDIENTE'").fetchone()[0]
            }
            browser.close()
            browser=None
            # Terminar antes de eliminar perfiles y cwd temporal.
            for p in reversed(processes):
                if p.poll() is None:
                    os.killpg(p.pid,signal.SIGTERM)
                    try: p.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(p.pid,signal.SIGKILL); p.wait(timeout=5)
            processes.clear()
    except Exception as error:
        # No volcar excepciones DB, variables de entorno ni payloads autenticados.
        evidence['failure']={'type':type(error).__name__,
                             'reason':str(error) if isinstance(error,(AssertionError,RuntimeError)) else 'Error interno del laboratorio; sin detalles sensibles'}
        if browser:
            evidence['http_browser']=browser.http
            evidence['page_diagnostic']=browser.js("({path:location.pathname,text:document.body.innerText.slice(0,2000),content:document.body.textContent.slice(-2000)})")
            evidence['browser_errors']=browser.errors
        print('E2E interrumpido:',evidence['failure'],flush=True)
    finally:
        if browser:
            browser.close()
        for p in reversed(processes):
            if p.poll() is None:
                os.killpg(p.pid,signal.SIGTERM)
                try: p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(p.pid,signal.SIGKILL); p.wait(timeout=5)
        if temporary:
            temporary.cleanup()
        if db:
            db.close()
        pg.close()
        evidence['cleanup']=all(pg.inspect_resource(kind,name) is None for kind,name in pg.candidates)
        evidence['resources']=[{'kind':kind,'name':name} for kind,name in pg.candidates]
        report.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
        print('Evidencia sin secretos:',report,flush=True)
        print('Limpieza confirmada:',evidence['cleanup'],flush=True)
    return 1 if 'failure' in evidence else 0


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--docker-local',action='store_true',required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    sys.exit(run(args.report))
