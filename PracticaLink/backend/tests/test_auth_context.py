import os
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "postgresql+psycopg://user:password@localhost:5432/practicalink_test",
)
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.auth.schemas import ContextoUsuarioResponse, PracticaActualContext  # noqa: E402
from app.auth.service import obtener_contexto_usuario  # noqa: E402
from app.core.database import get_db  # noqa: E402
from app.core.security import get_current_user_id  # noqa: E402
from app.main import app  # noqa: E402


class PracticaActualContextTests(unittest.TestCase):
    def test_accepts_current_shape(self) -> None:
        model = PracticaActualContext(
            id_practica=101,
            estado={
                "id_estado": 1,
                "nombre": "REGISTRADA",
                "es_final": False,
            },
            centro_practica={
                "id_centro": 22,
                "nombre": "Centro de prueba",
            },
            fecha_inicio=date(2026, 3, 2),
            fecha_termino=date(2026, 6, 30),
            horas=360,
            cargo_funcion="Desarrollador",
        )

        self.assertEqual(model.id_practica, 101)
        self.assertEqual(model.estado.nombre, "REGISTRADA")
        self.assertEqual(model.centro_practica.nombre, "Centro de prueba")
        self.assertEqual(model.fecha_inicio, date(2026, 3, 2))
        self.assertEqual(model.fecha_termino, date(2026, 6, 30))
        self.assertEqual(model.horas, 360)
        self.assertEqual(model.cargo_funcion, "Desarrollador")


class ObtenerContextoUsuarioTests(unittest.TestCase):
    def test_executes_fn_contexto_usuario_with_authenticated_user_id(self) -> None:
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = {
            "usuario": {
                "id_usuario": 55,
                "nombre": "Usuario",
                "apellido": "Demo",
                "correo": "demo@practicalink.cl",
            },
            "roles": ["ESTUDIANTE"],
            "perfil": None,
            "practica_actual": None,
        }

        resultado = obtener_contexto_usuario(db, 55)

        self.assertIsNone(resultado["perfil"])
        db.execute.assert_called_once()
        sql = db.execute.call_args.args[0]
        params = db.execute.call_args.args[1]
        self.assertIn("fn_contexto_usuario", str(sql))
        self.assertEqual(params["id_usuario"], 55)


class AuthContextRouteTests(unittest.TestCase):
    def _contexto_base(self, practica_actual):
        return {
            "usuario": {
                "id_usuario": 55,
                "nombre": "Usuario",
                "apellido": "Demo",
                "correo": "demo@practicalink.cl",
            },
            "roles": ["ESTUDIANTE"],
            "perfil": {
                "id_estudiante": 9,
                "rut": "12.345.678-5",
                "carrera": "Ingeniería",
                "sede": "Santiago",
            },
            "practica_actual": practica_actual,
        }

    def _override_context_route(self, contexto):
        db = MagicMock(name="db")
        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: 55
        return db, original_overrides

    def test_returns_context_without_practice(self) -> None:
        contexto = self._contexto_base(practica_actual=None)
        db, original_overrides = self._override_context_route(contexto)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ESTUDIANTE"]},
            ) as permiso_mock, patch(
                "app.auth.routes.obtener_contexto_usuario",
                return_value=contexto,
            ) as contexto_mock:
                with TestClient(app) as client:
                    response = client.get("/auth/context?id_usuario=999")

                self.assertEqual(response.status_code, 200)
                self.assertIsNone(response.json()["practica_actual"])
                permiso_mock.assert_called_once_with(db=db, id_usuario=55)
                contexto_mock.assert_called_once_with(db=db, id_usuario=55)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_returns_context_with_practice(self) -> None:
        practica_actual = {
            "id_practica": 101,
            "estado": {
                "id_estado": 1,
                "nombre": "REGISTRADA",
                "es_final": False,
            },
            "centro_practica": {
                "id_centro": 22,
                "nombre": "Centro de prueba",
            },
            "fecha_inicio": "2026-03-02",
            "fecha_termino": "2026-06-30",
            "horas": 360,
            "cargo_funcion": "Desarrollador",
        }
        contexto = self._contexto_base(practica_actual=practica_actual)
        db, original_overrides = self._override_context_route(contexto)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ESTUDIANTE"]},
            ) as permiso_mock, patch(
                "app.auth.routes.obtener_contexto_usuario",
                return_value=contexto,
            ) as contexto_mock:
                with TestClient(app) as client:
                    response = client.get("/auth/context")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.json()["practica_actual"],
                    practica_actual,
                )
                permiso_mock.assert_called_once_with(db=db, id_usuario=55)
                contexto_mock.assert_called_once_with(db=db, id_usuario=55)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)


if __name__ == "__main__":
    unittest.main()
