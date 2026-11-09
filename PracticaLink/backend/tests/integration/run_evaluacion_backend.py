"""Opt-in S4.3 backend integration. Reuses the existing owned Docker laboratory.
--sql-preflight-only needs only stdlib; HTTP mode needs the project's installed venv.
Never accepts an external database URL; no images/dependencies are downloaded.
"""
import argparse
import ast
from contextlib import ExitStack
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import secrets
import sys
import tempfile
from unittest.mock import patch
from uuid import uuid4
from run_inicio_practica import LocalPostgres, ROOT


def preflight_sql():
    tree = ast.parse((ROOT/'PracticaLink/backend/app/informes/database.py').read_text())
    return next(node.args[0].value for node in ast.walk(tree) if isinstance(node,ast.Call)
                and isinstance(node.func,ast.Name) and node.func.id=='text'
                and isinstance(node.args[0],ast.Constant))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--docker-local',action='store_true',required=True)
    parser.add_argument('--sql-preflight-only',action='store_true')
    args = parser.parse_args()
    if not args.sql_preflight_only:
        missing = [name for name in ['fastapi','pydantic','pydantic_settings','sqlalchemy','psycopg','jwt','httpx','pypdf','pwdlib','bcrypt','email_validator'] if importlib.util.find_spec(name) is None]
        if missing:
            print('BLOCKED: faltan dependencias locales: '+', '.join(missing))
            return 2
    pg = LocalPostgres('postgres:18.6')
    try:
        pg.start()
        for path in sorted((ROOT/'PracticaLink/supabase/migrations').glob('*.sql')):
            if '20261103130000' < path.name[:14] <= '20261109100000':
                pg.sql('BEGIN;\n'+path.read_text()+'\nCOMMIT;')
        sql = preflight_sql()
        if pg.sql('BEGIN; SET LOCAL ROLE pl_s42_executor; '+sql+'; ROLLBACK;').stdout.strip() != 't':
            raise RuntimeError('academic preflight rejected the restricted executor')
        for change in [
            'GRANT SELECT ON public.evaluacion_informe TO pl_s42_executor;',
            'GRANT pl_s43_cierre_owner TO pl_s42_executor;',
            'REVOKE EXECUTE ON FUNCTION informes_privados.iniciar_evaluacion(bigint,bigint,uuid,bigint,bigint) FROM pl_s42_executor;']:
            result = pg.sql('BEGIN; '+change+' SET LOCAL ROLE pl_s42_executor; '+sql+'; ROLLBACK;').stdout.strip()
            if result != 'f': raise RuntimeError('preflight accepted unsafe/missing privileges')
        print('PASS SQL preflight: exact signatures, restricted executor, DML/membership/EXECUTE denials',flush=True)
        if args.sql_preflight_only: return 0
        return http_tests(pg)
    finally:
        pg.close()


def http_tests(pg):
    sys.path.insert(0,str(ROOT/'PracticaLink/backend'))
    from sqlalchemy import create_engine
    from sqlalchemy.engine import URL
    from sqlalchemy.orm import sessionmaker
    from pydantic_settings import DotEnvSettingsSource
    from fastapi.testclient import TestClient
    from pypdf import PdfWriter
    source=(Path(__file__).parent/'s43_evaluacion_academica.sql').read_text()
    pg.sql(source.split('CREATE FUNCTION pg_temp.ok')[0]+'COMMIT;')
    pg.sql("UPDATE public.usuario SET correo=replace(correo,'@example.invalid','@example.com') WHERE id_usuario BETWEEN 430 AND 439;")
    private_password, assignment_password = secrets.token_hex(24),secrets.token_hex(24)
    pg.sql(f"CREATE ROLE s43_http_academic LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '{private_password}'; GRANT pl_s42_executor TO s43_http_academic; CREATE ROLE s43_http_assignment LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '{assignment_password}'; GRANT pl_s41_docente_executor TO s43_http_assignment;")
    def url(user,password):
        return URL.create('postgresql+psycopg',username=user,password=password,host=pg.host,port=5432,database='ep04_integration').render_as_string(hide_password=False)
    class MemoryStorage:
        def __init__(self): self.objects={}
        def verify(self): pass
        def put(self,key,data,digest):
            if hashlib.sha256(data).hexdigest()!=digest: raise RuntimeError('hash mismatch')
            if key in self.objects and self.objects[key]!=data: raise RuntimeError('overwrite attempted')
            self.objects[key]=data
        def read(self,key): return self.objects[key]
        def delete(self,key): self.objects.pop(key,None)
    with ExitStack() as stack:
        # Prevent .env reads and inherited connection/provider configuration.
        stack.enter_context(patch.object(DotEnvSettingsSource,'_read_env_files',return_value={}))
        stack.enter_context(patch.dict(os.environ,{
            'SUPABASE_DATABASE_URL':'postgresql+psycopg://unused:synthetic@127.0.0.1:1/unavailable',
            'INFORME_DATABASE_URL':url('s43_http_academic',private_password),
            'DOCENTE_ASSIGNMENT_DATABASE_URL':url('s43_http_assignment',assignment_password),
            'JWT_SECRET_KEY':secrets.token_hex(32),'FIREBASE_SERVICE_ACCOUNT_JSON':''},clear=True))
        from app.main import app
        from app.core.database import get_db,engine
        from app.core.security import create_access_token
        from app.informes.routes import get_storage
        from app.informes import database as academic_db
        from app.core import database as ordinary_db
        admin_engine=create_engine(url('postgres',pg.admin_password),hide_parameters=True)
        factory=sessionmaker(bind=admin_engine)
        stack.callback(admin_engine.dispose); stack.callback(engine.dispose)
        previous=dict(app.dependency_overrides)
        def restore(): app.dependency_overrides.clear(); app.dependency_overrides.update(previous)
        stack.callback(restore)
        def auth_session():
            with factory() as db: yield db
        app.dependency_overrides[get_db]=auth_session
        storage=MemoryStorage(); app.dependency_overrides[get_storage]=lambda:storage
        stack.enter_context(patch('app.services.estado_practica_service.enviar_push_notificacion',return_value=0))
        def dispose_private():
            if academic_db._factory is not None: academic_db._factory.kw['bind'].dispose()
            if ordinary_db._docente_factory is not None: ordinary_db._docente_factory.kw['bind'].dispose()
        stack.callback(dispose_private)
        client=stack.enter_context(TestClient(app))
        def headers(actor,key=None):
            h={'Authorization':'Bearer '+create_access_token(actor)}
            if key: h['Idempotency-Key']=str(key)
            return h
        def expect(response,status):
            if response.status_code!=status: raise RuntimeError(f'HTTP {response.status_code}, expected {status}')
            if private_password in response.text or assignment_password in response.text: raise RuntimeError('secret exposed')
            return response.json()
        def upload(version):
            writer=PdfWriter();writer.add_blank_page(width=100,height=100);stream=io.BytesIO();writer.write(stream)
            return client.post('/practicas/430/informe-final',headers={**headers(430,uuid4()),'Content-Type':'application/pdf','Version-Esperada':str(version),'Nombre-Archivo':'informe.pdf'},content=stream.getvalue())
        def start(actor,document,version,key):
            return client.post('/practicas/430/evaluaciones/inicio',headers=headers(actor,key),json={'id_documento':document,'version':version})
        def resolve(actor,evaluation,result,key,obs=None):
            return client.post(f'/practicas/430/evaluaciones/{evaluation}/resolucion',headers=headers(actor,key),json={'resultado':result,'observaciones':obs})
        expect(client.get('/practicas/430/evaluaciones'),401)
        first=expect(upload(0),200); key=uuid4()
        ev=expect(start(432,first['id_documento'],1,key),200)
        expect(start(432,first['id_documento'],1,key),200)
        expect(resolve(432,ev['id_evaluacion'],'CON_OBSERVACIONES',uuid4(),' '),400)
        key=uuid4();expect(resolve(432,ev['id_evaluacion'],'CON_OBSERVACIONES',key,'Corregir'),200)
        expect(resolve(432,ev['id_evaluacion'],'CON_OBSERVACIONES',key,'Corregir'),200)
        second=expect(upload(1),200)
        ev=expect(start(432,second['id_documento'],2,uuid4()),200)
        expect(client.put('/docente/practicas/430/asignacion',headers=headers(431),json={'id_docente':433,'motivo':'Reasignación durante evaluación'}),200)
        expect(resolve(432,ev['id_evaluacion'],'APROBADO',uuid4()),403)
        ev=expect(start(433,second['id_documento'],2,uuid4()),200)
        key=uuid4();expect(resolve(433,ev['id_evaluacion'],'APROBADO',key),200)
        expect(resolve(433,ev['id_evaluacion'],'APROBADO',key),200)
        expect(upload(2),409)
        expect(start(434,second['id_documento'],2,uuid4()),403)
        expect(client.post('/practicas/430/cierre',headers=headers(434),json={}),403)
        expect(client.post('/practicas/430/cierre',headers=headers(435),json={}),403)
        state=expect(client.get('/practicas/430/evaluaciones',headers=headers(430)),200)
        if state['resultado_vigente']['resultado']!='APROBADO' or len(state['historial'])!=3: raise RuntimeError('academic state/history mismatch')
        expect(client.post('/practicas/430/cierre',headers=headers(431),json={}),200)
        expect(start(433,second['id_documento'],2,uuid4()),403)
        count=pg.sql("SELECT count(*) FROM public.notificacion WHERE id_practica=430 AND tipo='INFORME_FINAL_EVALUADO'").stdout.strip()
        if count!='4': raise RuntimeError('duplicate academic notifications')
        print('PASS HTTP + PostgreSQL: JWT, real private executor/preflight, upload mock Storage, evaluation, reassignment, idempotency and secure closure',flush=True)
    return 0


if __name__=='__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # No SQL, connection URLs, generated passwords or provider details.
        print('FAILED local backend integration: '+type(error).__name__,file=sys.stderr)
        raise SystemExit(1)
