"""Regresión SQL EP08 en PostgreSQL sintético local; nunca conecta a Supabase."""

from concurrent.futures import ThreadPoolExecutor
import json
import sys
import unittest

from run_inicio_practica import LocalPostgres, ROOT


MIGRATION = ROOT / "PracticaLink/supabase/migrations/20261107100000_ep08_revision_autoasignacion_gestor.sql"


class RevisionAutoasignacionIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pg = LocalPostgres("postgres:18.6")
        cls.pg.start()
        cls.pg.sql(MIGRATION.read_text())
        cls.pg.sql("""
            INSERT INTO practica(id_practica,id_estudiante,id_centro,id_estado_actual)
            SELECT n,100,100,ep.id_estado
            FROM generate_series(1001,1010) n
            CROSS JOIN public.estado_practica ep
            WHERE ep.nombre='REGISTRADA';
            INSERT INTO practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor)
            SELECT 1011,100,100,ep.id_estado,103
            FROM public.estado_practica ep WHERE ep.nombre='REGISTRADA';
            INSERT INTO usuario_rol(id_usuario,id_rol)
            SELECT 102,id_rol FROM rol WHERE nombre='GESTOR';
            INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash)
            VALUES(104,'Admin Solo','Sintetico','admin-only@example.invalid','synthetic-hash');
            INSERT INTO usuario_rol(id_usuario,id_rol)
            SELECT 104,id_rol FROM rol WHERE nombre='ADMINISTRADOR';
        """)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "pg"):
            cls.pg.close()

    @classmethod
    def sql(cls, statement, check=True):
        return cls.pg.sql(statement, check=check)

    def decision(self, practice, user, decision, observation="NULL"):
        result = self.sql(
            "SELECT public.fn_revisar_practica("
            f"{practice},{user},'{decision}',{observation})"
        )
        return json.loads(result.stdout.strip())

    def test_approval_assigns_manager_and_is_visible_to_states_and_followups(self):
        result = self.decision(1001, 101, "APROBADA")
        self.assertEqual(result["estado"], "APROBADA")
        self.assertEqual(self.sql("SELECT id_gestor FROM practica WHERE id_practica=1001").stdout.strip(), "101")
        self.assertEqual(self.sql("SELECT count(*) FROM historial_estado WHERE id_practica=1001 AND id_usuario=101").stdout.strip(), "1")
        self.assertEqual(self.sql("SELECT count(*) FROM notificacion WHERE id_practica=1001").stdout.strip(), "1")
        estados = json.loads(self.sql("SELECT public.fn_listar_practicas_gestion_usuario(101)").stdout.strip())
        self.assertTrue(any(item["id_practica"] == 1001 for item in estados))
        self.assertEqual(self.sql("SELECT public.fn_puede_gestionar_practica(1001,101)").stdout.strip(), "t")
        self.assertEqual(self.sql("SELECT public.fn_puede_gestionar_practica(1001,103)").stdout.strip(), "f")

    def test_observation_and_rejection_preserve_existing_assignment(self):
        self.sql("UPDATE practica SET id_gestor=103 WHERE id_practica IN (1002,1003)")
        self.assertEqual(self.decision(1002,101,"OBSERVADA", "'Faltan antecedentes'")["estado"], "OBSERVADA")
        self.assertEqual(self.decision(1003,101,"RECHAZADA", "'No cumple'")["estado"], "RECHAZADA")
        self.assertEqual(self.sql("SELECT string_agg(id_gestor::text,',' ORDER BY id_practica) FROM practica WHERE id_practica IN (1002,1003)").stdout.strip(), "103,103")

    def test_actor_role_active_assignment_and_revisable_state(self):
        self.assertEqual(self.decision(1004,104,"APROBADA")["error"], "USUARIO_NO_AUTORIZADO")
        self.assertEqual(self.decision(1009,102,"APROBADA")["estado"], "APROBADA")
        self.sql("UPDATE usuario SET activo=false WHERE id_usuario=101")
        self.assertEqual(self.decision(1005,101,"APROBADA")["error"], "USUARIO_NO_AUTORIZADO")
        self.sql("UPDATE usuario SET activo=true WHERE id_usuario=101")
        self.assertEqual(self.decision(1011,101,"APROBADA")["error"], "GESTOR_ASIGNADO_A_OTRO")
        self.sql("UPDATE practica SET id_estado_actual=(SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO') WHERE id_practica=1006")
        self.assertEqual(self.decision(1006,101,"APROBADA")["error"], "SOLICITUD_NO_REVISABLE")

    def test_two_gestores_cannot_both_approve_the_same_practice(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda manager: self.decision(1007,manager,"APROBADA"), (101,103)))
        self.assertEqual(sum(result.get("estado") == "APROBADA" for result in results), 1)
        self.assertEqual(sum(bool(result.get("error")) for result in results), 1)
        self.assertEqual(self.sql("SELECT count(*) FROM historial_estado WHERE id_practica=1007").stdout.strip(), "1")
        self.assertEqual(self.sql("SELECT count(*) FROM notificacion WHERE id_practica=1007").stdout.strip(), "1")

    def test_notification_failure_rolls_back_state_assignment_and_history(self):
        self.sql("""
            CREATE FUNCTION public.ep08_fail_notification() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic notification failure'; END $$;
            CREATE TRIGGER ep08_fail_notification BEFORE INSERT ON public.notificacion
            FOR EACH ROW EXECUTE FUNCTION public.ep08_fail_notification();
        """)
        failed = self.sql("SELECT public.fn_revisar_practica(1008,101,'APROBADA',NULL)", check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.sql("DROP TRIGGER ep08_fail_notification ON public.notificacion; DROP FUNCTION public.ep08_fail_notification();")
        self.assertEqual(self.sql("SELECT ep.nombre||':'||coalesce(p.id_gestor::text,'NULL') FROM practica p JOIN estado_practica ep ON ep.id_estado=p.id_estado_actual WHERE p.id_practica=1008").stdout.strip(), "REGISTRADA:NULL")
        self.assertEqual(self.sql("SELECT count(*) FROM historial_estado WHERE id_practica=1008").stdout.strip(), "0")

    def test_execute_acl_is_private_to_database_owner(self):
        self.assertEqual(self.sql("SELECT has_function_privilege(current_user,'public.fn_revisar_practica(bigint,bigint,character varying,character varying)','EXECUTE')").stdout.strip(), "t")
        for role in ("anon", "authenticated", "service_role"):
            with self.subTest(role=role):
                self.assertEqual(self.sql(f"SELECT has_function_privilege('{role}','public.fn_revisar_practica(bigint,bigint,character varying,character varying)','EXECUTE')").stdout.strip(), "f")


def main():
    if "--docker-local" not in sys.argv:
        raise SystemExit("Ejecutar explícitamente con --docker-local; usa PostgreSQL sintético aislado.")
    sys.argv = [sys.argv[0], "-v"]
    unittest.main()


if __name__ == "__main__":
    main()
