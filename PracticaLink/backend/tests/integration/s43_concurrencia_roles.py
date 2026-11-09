"""E05: real concurrent sessions inside the S4.3 isolated synthetic runner."""
import selectors
import subprocess
import time
from uuid import uuid4


def run_cases(sql, base, check):
    admin = 's43_e05_accounts'
    executor = 'pl_s42_executor'
    sql(f"""CREATE ROLE {admin} NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
      GRANT USAGE ON SCHEMA public TO {admin};
      GRANT SELECT,UPDATE(activo) ON public.usuario TO {admin};
      GRANT SELECT,INSERT,DELETE ON public.usuario_rol TO {admin};
      GRANT SELECT,UPDATE(activo) ON public.rol TO {admin};
      CREATE POLICY e05_user_read ON public.usuario FOR SELECT TO {admin} USING(true);
      CREATE POLICY e05_user_write ON public.usuario FOR UPDATE TO {admin} USING(id_usuario=432) WITH CHECK(id_usuario=432);
      CREATE POLICY e05_memberships ON public.usuario_rol TO {admin} USING(id_usuario=432) WITH CHECK(id_usuario=432);
      CREATE POLICY e05_role_read ON public.rol FOR SELECT TO {admin} USING(true);
      CREATE POLICY e05_role_write ON public.rol FOR UPDATE TO {admin} USING(nombre='DOCENTE') WITH CHECK(nombre='DOCENTE');
      SET ROLE {admin};
      DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole)
        OR pg_has_role(current_user,'pl_s42_owner','MEMBER') THEN RAISE EXCEPTION 'E05 unsafe account writer'; END IF; END $$;"""
    )

    def expect(statement, state):
        escaped = statement.replace("'", "''")
        return f"DO $e05$ BEGIN BEGIN EXECUTE '{escaped}'; EXCEPTION WHEN SQLSTATE '{state}' THEN RETURN; END; RAISE EXCEPTION 'E05 expected {state}'; END $e05$"

    def verify(condition, label):
        check(sql('SELECT (' + condition + ')') == 't', 'E05: ' + label)

    def paired(first, second, label, first_role=executor, second_role=executor,
               wait=True, finish='COMMIT'):
        # Prove ordering through actual pg_blocking_pids, not sleep-based assumptions.
        tag = 'e05_' + uuid4().hex[:12]
        processes = []
        try:
            a = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
            processes.append(a)
            a.stdin.write(f"\\o /dev/null\nSET application_name='{tag}_a'; SET statement_timeout='15s'; SET lock_timeout='10s'; BEGIN; SET LOCAL ROLE {first_role}; {first};\n\\o\n\\echo READY\n")
            a.stdin.flush()
            with selectors.DefaultSelector() as selector:
                selector.register(a.stdout, selectors.EVENT_READ)
                check(bool(selector.select(20)), label + ': first session timed out')
                marker = a.stdout.readline().strip()
                check(marker == 'READY', label + ': first failed: ' + (a.stderr.read() if a.poll() is not None else marker))
            b = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
            processes.append(b)
            b.stdin.write(f"SET application_name='{tag}_b'; SET statement_timeout='15s'; SET lock_timeout='10s'; BEGIN; SET LOCAL ROLE {second_role}; {second}; COMMIT;\n")
            b.stdin.close()
            if wait:
                deadline = time.monotonic() + 7
                while time.monotonic() < deadline:
                    blocked = sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='{tag}_a' WHERE b.application_name='{tag}_b' AND b.wait_event_type='Lock' AND a.pid=ANY(pg_blocking_pids(b.pid)))")
                    if blocked == 't':
                        break
                    if b.poll() is not None:
                        raise RuntimeError(label + ': expected a real wait, got: ' + b.stderr.read())
                    time.sleep(.05)
                else:
                    raise RuntimeError(label + ': blocking dependency not observed')
            else:
                # Different practice gates must permit progress with shared users.
                b.wait(timeout=8)
                check(b.returncode == 0, label + ': independent operation failed: ' + b.stderr.read())
            a.stdin.write(finish + ';\n'); a.stdin.close()
            for process in processes:
                process.wait(timeout=20)
                check(process.returncode == 0, label + ': ' + process.stderr.read())
            print('PASS E05 concurrency: ' + label, flush=True)
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill(); process.wait()

    next_practice = 630

    def fixture():
        nonlocal next_practice
        p = next_practice; next_practice += 1
        sql(f"INSERT INTO public.practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor,id_docente,fecha_termino) SELECT {p},430,430,id_estado,431,432,(clock_timestamp() AT TIME ZONE 'America/Santiago')::date FROM public.estado_practica WHERE nombre='EN_CURSO'")
        k = str(uuid4())
        sql(f"SET ROLE {executor}; SELECT informes_privados.reservar({p},430,'{k}',0,repeat('a',64),'e05.pdf',5); SELECT informes_privados.confirmar({p},430,'{k}')")
        d = int(sql(f'SELECT id_documento FROM public.informe_final WHERE id_practica={p}'))
        return p, d

    def start(p, d, key=None):
        return f"SELECT informes_privados.iniciar_evaluacion({p},432,'{key or uuid4()}',{d},1)"

    def pending(p, d):
        key = str(uuid4()); sql(f'SET ROLE {executor}; ' + start(p, d, key)); return key

    def resolve(p, eid, key=None):
        return f"SELECT informes_privados.resolver_evaluacion({p},432,'{key or uuid4()}','{eid}','APROBADO',NULL)"

    def close(p):
        return f'SELECT public.fn_cerrar_practica({p},431,NULL)'

    def snapshot(p):
        return sql(f"""SELECT jsonb_build_object(
          'evaluaciones',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id_evaluacion),'[]') FROM public.evaluacion_informe e WHERE id_practica={p}),
          'eventos',(SELECT coalesce(jsonb_agg(to_jsonb(ev) ORDER BY id_evento),'[]') FROM public.evaluacion_evento ev JOIN public.evaluacion_informe e USING(id_evaluacion) WHERE e.id_practica={p}),
          'avisos',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id_notificacion),'[]') FROM public.notificacion n WHERE id_practica={p}),
          'historial',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id_historial),'[]') FROM public.historial_estado h WHERE id_practica={p}),
          'cierre',(SELECT to_jsonb(c) FROM public.cierre_practica c WHERE id_practica={p}),
          'informe',(SELECT to_jsonb(f) FROM public.informe_final f WHERE id_practica={p}))""")

    def shape(p, state, notifications=0, closed=False):
        verify(f"(SELECT count(*)=1 AND bool_and(estado='{state}') FROM public.evaluacion_informe WHERE id_practica={p})", 'single evaluation ' + str(p))
        events = 2 if state == 'RESUELTA' else 1
        verify(f"(SELECT count(*)={events} AND count(DISTINCT tipo)={events} FROM public.evaluacion_evento ev JOIN public.evaluacion_informe e USING(id_evaluacion) WHERE e.id_practica={p})", 'unique academic history ' + str(p))
        verify(f"(SELECT count(*)={notifications} FROM public.notificacion WHERE id_practica={p} AND tipo='INFORME_FINAL_EVALUADO')", 'exact notification count ' + str(p))
        document_state = 'ENTREGADO' if state == 'RESUELTA' else 'EN_EVALUACION'
        verify(f"(SELECT estado='{document_state}' FROM public.informe_final WHERE id_practica={p})", 'document consistency ' + str(p))
        verify(f"(SELECT count(*)={int(closed)} FROM public.cierre_practica WHERE id_practica={p})", 'closure count ' + str(p))
        verify(f"(SELECT count(*)={int(closed)} FROM public.historial_estado h JOIN public.estado_practica ep USING(id_estado) WHERE h.id_practica={p} AND ep.nombre='FINALIZADA')", 'final history count ' + str(p))

    account_changes = [
        ('account deactivation', 'UPDATE public.usuario SET activo=false WHERE id_usuario=432',
         'UPDATE public.usuario SET activo=true WHERE id_usuario=432'),
        ('DOCENTE membership removal', "DELETE FROM public.usuario_rol WHERE id_usuario=432 AND id_rol=(SELECT id_rol FROM public.rol WHERE nombre='DOCENTE')",
         "INSERT INTO public.usuario_rol SELECT 432,id_rol FROM public.rol WHERE nombre='DOCENTE'"),
        ('DOCENTE catalog deactivation', "UPDATE public.rol SET activo=false WHERE nombre='DOCENTE'",
         "UPDATE public.rol SET activo=true WHERE nombre='DOCENTE'")
    ]
    for label, revoke, restore in account_changes:
        p, d = fixture(); before = snapshot(p)
        paired(revoke, expect(start(p,d), '42501'), label + ' before start: revalidate after lock', first_role=admin)
        check(snapshot(p) == before, label + ': rejected start left writes')
        sql(f'SET ROLE {admin}; ' + restore)

        p, d = fixture(); key = str(uuid4())
        paired(start(p,d,key), revoke, 'start before ' + label, second_role=admin)
        before = snapshot(p)
        sql(f'SET ROLE {executor}; ' + expect(resolve(p,key), '42501'))
        check(snapshot(p) == before, label + ': invalid teacher changed pending evaluation')
        shape(p,'EN_CURSO')
        sql(f'SET ROLE {admin}; ' + restore)

        p, d = fixture(); eid = pending(p,d); before = snapshot(p)
        paired(revoke, expect(resolve(p,eid), '42501'), label + ' before resolution: revalidate after lock', first_role=admin)
        check(snapshot(p) == before, label + ': rejected resolution left writes')
        shape(p,'EN_CURSO')
        sql(f'SET ROLE {admin}; ' + restore)
        # Restored authorization may resolve the same pending evaluation, without a second start.
        key = str(uuid4()); sql(f'SET ROLE {executor}; ' + resolve(p,eid,key))
        sql(f'SET ROLE {executor}; ' + resolve(p,eid,key)); shape(p,'RESUELTA',2)

        p, d = fixture(); eid = pending(p,d); key = str(uuid4())
        paired(resolve(p,eid,key), revoke, 'resolution before ' + label, second_role=admin)
        shape(p,'RESUELTA',2); before = snapshot(p)
        sql(f'SET ROLE {executor}; ' + expect(resolve(p,eid,key),'42501'))
        check(snapshot(p) == before, label + ': retry bypassed revoked authorization')
        sql(f'SET ROLE {admin}; ' + restore)

    p, d = fixture(); q, other_document = fixture(); a, b = str(uuid4()), str(uuid4())
    paired(start(p,d,a),start(q,other_document,b),'different practices, same teacher/student/gestor: starts overlap',wait=False)
    sql(f'SET ROLE {executor}; '+start(p,d,a)+'; '+start(q,other_document,b))
    shape(p,'EN_CURSO'); shape(q,'EN_CURSO')
    ka,kb = str(uuid4()),str(uuid4())
    paired(resolve(p,a,ka),resolve(q,b,kb),'different practices, shared identities: resolutions overlap',wait=False)
    sql(f'SET ROLE {executor}; '+resolve(p,a,ka)+'; '+resolve(q,b,kb))
    shape(p,'RESUELTA',2); shape(q,'RESUELTA',2)

    p, d = fixture(); eid = pending(p,d)
    paired(resolve(p,eid),close(q),'resolution and closure on different practices overlap',wait=False)
    shape(p,'RESUELTA',2); shape(q,'RESUELTA',2,closed=True)

    p, d = fixture(); eid = pending(p,d); before = snapshot(p)
    # A normal consultation holds the practice gate while the refused close is caught.
    paired(f'SELECT informes_privados.consultar({p},431); '+expect(close(p),'P0409'),
           resolve(p,eid),'closure before approval is rejected; waiting resolution succeeds')
    shape(p,'RESUELTA',2)
    sql(f'SET ROLE {executor}; '+close(p)); shape(p,'RESUELTA',2,closed=True)
    p, d = fixture(); eid = pending(p,d)
    paired(resolve(p,eid),close(p),'approval before waiting closure succeeds')
    shape(p,'RESUELTA',2,closed=True)

    p, d = fixture(); key = str(uuid4())
    paired(start(p,d,key),start(p,d,key),'rolled-back start permits exactly one waiting retry',finish='ROLLBACK')
    shape(p,'EN_CURSO')
    p, d = fixture(); eid = pending(p,d); before = snapshot(p)
    paired(resolve(p,eid),expect(close(p),'P0409'),'rolled-back approval cannot authorize waiting closure',finish='ROLLBACK')
    check(snapshot(p) == before,'rollback lost pending history or leaked academic notifications')
    shape(p,'EN_CURSO')
    p, d = fixture(); key = str(uuid4())
    paired(account_changes[0][1],start(p,d,key),'rolled-back deactivation revalidates active teacher after wait',first_role=admin,finish='ROLLBACK')
    shape(p,'EN_CURSO')
    print('PASS E05 integrity: no duplicates, rollback, version/history consistency and live authorization',flush=True)
