import os
import unittest
from datetime import datetime
from unittest.mock import MagicMock


os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "postgresql+psycopg://user:password@localhost:5432/practicalink_test",
)
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.services.revision_service import listar_solicitudes  # noqa: E402


class ListarSolicitudesTests(unittest.TestCase):
    def test_returns_minimal_data_for_each_solicitud(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.mappings.return_value.all.return_value = [
            {
                "id_practica": 101,
                "fecha_registro": datetime(2026, 9, 1, 10, 30, 0),
                "estado": "REGISTRADA",
                "estudiante": "Ana Perez",
                "rut_estudiante": "12.345.678-5",
                "centro_practica": "Centro de prueba",
            },
            {
                "id_practica": 202,
                "fecha_registro": datetime(2026, 9, 2, 9, 15, 0),
                "estado": "EN_REVISION",
                "estudiante": "Bruno Soto",
                "rut_estudiante": "11.222.333-4",
                "centro_practica": "Centro Norte",
            },
        ]

        resultado = listar_solicitudes(db)

        self.assertEqual(
            resultado,
            [
                {
                    "id_practica": 101,
                    "fecha_registro": datetime(2026, 9, 1, 10, 30, 0),
                    "estado": "REGISTRADA",
                    "estudiante": "Ana Perez",
                    "rut_estudiante": "12.345.678-5",
                    "centro_practica": "Centro de prueba",
                },
                {
                    "id_practica": 202,
                    "fecha_registro": datetime(2026, 9, 2, 9, 15, 0),
                    "estado": "EN_REVISION",
                    "estudiante": "Bruno Soto",
                    "rut_estudiante": "11.222.333-4",
                    "centro_practica": "Centro Norte",
                },
            ],
        )

        db.execute.assert_called_once()
        sql = str(db.execute.call_args.args[0])
        self.assertIn("SELECT p.id_practica", sql)
        self.assertIn("CONCAT(u.nombre, ' ', u.apellido) AS estudiante", sql)
        self.assertIn("ep.nombre AS estado", sql)
        self.assertIn("WHERE ep.nombre IN ('REGISTRADA', 'EN_REVISION', 'OBSERVADA')", sql)

    def test_returns_empty_list_when_there_are_no_solicitudes(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.mappings.return_value.all.return_value = []

        resultado = listar_solicitudes(db)

        self.assertEqual(resultado, [])
        db.execute.assert_called_once()


if __name__ == "__main__":
    unittest.main()
