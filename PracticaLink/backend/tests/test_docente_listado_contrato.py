import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "postgresql+psycopg://user:password@localhost:5432/practicalink_test",
)
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.core.database import get_docente_assignment_db  # noqa: E402
from app.core.security import get_current_user_id  # noqa: E402
from app.docentes.schemas import PracticaDocenteResponse  # noqa: E402
from app.main import app  # noqa: E402


FILA_BASE = {
    "estado": "EN_CURSO", "estudiante": "Estudiante sintético", "centro_practica": "Centro sintético",
    "fecha_inicio": None, "fecha_termino": None, "cargo_funcion": None, "descripcion": None,
}


class ContratoListadoDocenteTests(unittest.TestCase):
    def _override(self, db: MagicMock) -> dict:
        original = dict(app.dependency_overrides)
        app.dependency_overrides[get_docente_assignment_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: 33
        return original

    def test_listado_incluye_estado_del_informe_y_resultado_vigente(self) -> None:
        db = MagicMock(name="db")
        filas = [
            {**FILA_BASE, "id_practica": 1, "informe_estado": "ENTREGADO", "informe_version": 2,
             "evaluacion_resultado": None},
            {**FILA_BASE, "id_practica": 2, "informe_estado": "ENTREGADO", "informe_version": 1,
             "evaluacion_resultado": "APROBADO"},
            {**FILA_BASE, "id_practica": 3, "informe_estado": None, "informe_version": None,
             "evaluacion_resultado": None},
        ]
        original = self._override(db)
        try:
            with patch("app.core.permissions.obtener_contexto_usuario", return_value={"roles": ["DOCENTE"]}), \
                 patch("app.docentes.routes.listar_practicas_docente", return_value=filas):
                with TestClient(app) as client:
                    respuesta = client.get("/docente/practicas")
            self.assertEqual(respuesta.status_code, 200)
            cuerpo = respuesta.json()
            self.assertEqual(cuerpo[0]["informe_estado"], "ENTREGADO")
            self.assertEqual(cuerpo[0]["informe_version"], 2)
            self.assertIsNone(cuerpo[0]["evaluacion_resultado"])
            self.assertEqual(cuerpo[1]["evaluacion_resultado"], "APROBADO")
            self.assertIsNone(cuerpo[2]["informe_estado"])
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original)

    def test_los_campos_nuevos_son_opcionales_y_validan_valores(self) -> None:
        sin_informe = PracticaDocenteResponse(id_practica=9, **FILA_BASE)
        self.assertIsNone(sin_informe.informe_estado)
        with self.assertRaises(ValueError):
            PracticaDocenteResponse(id_practica=9, **FILA_BASE, informe_estado="BORRADOR")
        with self.assertRaises(ValueError):
            PracticaDocenteResponse(id_practica=9, **FILA_BASE, evaluacion_resultado="OTRO")


if __name__ == "__main__":
    unittest.main()
