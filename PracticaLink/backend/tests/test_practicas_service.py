import inspect
import unittest
from datetime import date, datetime
from unittest.mock import MagicMock

from app.practicas.schemas import PracticaDetalleResponse
from app.practicas.service import (
    PerfilEstudianteNoEncontradoError,
    PracticaNoEncontradaError,
    obtener_practica_del_estudiante,
)


class ObtenerPracticaDelEstudianteTests(unittest.TestCase):
    def _mock_estudiante(self, id_estudiante: int = 9) -> MagicMock:
        db = MagicMock()
        db.execute.side_effect = [
            MagicMock(
                mappings=MagicMock(
                    return_value=MagicMock(
                        first=MagicMock(return_value={"id_estudiante": id_estudiante})
                    )
                )
            ),
            MagicMock(
                mappings=MagicMock(
                    return_value=MagicMock(
                        first=MagicMock(
                            return_value={
                                "id_practica": 101,
                                "fecha_registro": datetime(2026, 9, 1, 10, 30, 0),
                                "fecha_inicio": date(2026, 3, 2),
                                "fecha_termino": date(2026, 6, 30),
                                "horas": 360,
                                "cargo_funcion": "Desarrollador",
                                "descripcion": "Practica de caracterizacion",
                                "id_estado": 1,
                                "estado_nombre": "REGISTRADA",
                                "es_final": False,
                                "id_centro": 22,
                                "centro_nombre": "Centro de prueba",
                                "rut_empresa": "12.345.678-5",
                                "direccion": "Av. Siempre Viva 123",
                                "telefono": "+56 9 1234 5678",
                                "correo": "contacto@empresa.cl",
                                "contacto_nombre": "Maria Perez",
                                "contacto_cargo": "Jefa de practica",
                            }
                        )
                    )
                )
            ),
        ]
        return db

    def test_signature_only_accepts_db_and_id_usuario(self) -> None:
        params = list(inspect.signature(obtener_practica_del_estudiante).parameters)

        self.assertEqual(params, ["db", "id_usuario"])

    def test_returns_practice_for_authenticated_user(self) -> None:
        db = self._mock_estudiante(id_estudiante=9)

        resultado = obtener_practica_del_estudiante(db, 55)

        self.assertEqual(resultado["id_practica"], 101)
        self.assertEqual(resultado["estado"]["nombre"], "REGISTRADA")
        self.assertEqual(resultado["centro_practica"]["nombre"], "Centro de prueba")
        self.assertEqual(resultado["horas"], 360)
        self.assertEqual(db.execute.call_args_list[0].args[1], {"id_usuario": 55})
        self.assertEqual(
            db.execute.call_args_list[1].args[1],
            {"id_estudiante": 9},
        )
        PracticaDetalleResponse(**resultado)

    def test_raises_when_student_profile_is_missing(self) -> None:
        db = MagicMock()
        db.execute.return_value.mappings.return_value.first.return_value = None

        with self.assertRaises(PerfilEstudianteNoEncontradoError):
            obtener_practica_del_estudiante(db, 55)

        db.execute.assert_called_once()

    def test_raises_when_practice_is_missing(self) -> None:
        db = MagicMock()
        db.execute.side_effect = [
            MagicMock(
                mappings=MagicMock(
                    return_value=MagicMock(
                        first=MagicMock(return_value={"id_estudiante": 9})
                    )
                )
            ),
            MagicMock(
                mappings=MagicMock(
                    return_value=MagicMock(first=MagicMock(return_value=None))
                )
            ),
        ]

        with self.assertRaises(PracticaNoEncontradaError):
            obtener_practica_del_estudiante(db, 55)

        self.assertEqual(db.execute.call_count, 2)

    def test_returns_structure_compatible_with_schema(self) -> None:
        db = self._mock_estudiante(id_estudiante=9)

        resultado = obtener_practica_del_estudiante(db, 55)
        model = PracticaDetalleResponse(**resultado)

        self.assertEqual(model.estado.id_estado, 1)
        self.assertEqual(model.centro_practica.id_centro, 22)
        self.assertEqual(
            model.model_dump(mode="json"),
            {
                "id_practica": 101,
                "fecha_registro": "2026-09-01T10:30:00",
                "estado": {
                    "id_estado": 1,
                    "nombre": "REGISTRADA",
                    "es_final": False,
                },
                "centro_practica": {
                    "id_centro": 22,
                    "nombre": "Centro de prueba",
                    "rut_empresa": "12.345.678-5",
                    "direccion": "Av. Siempre Viva 123",
                    "telefono": "+56 9 1234 5678",
                    "correo": "contacto@empresa.cl",
                    "contacto_nombre": "Maria Perez",
                    "contacto_cargo": "Jefa de practica",
                },
                "fecha_inicio": "2026-03-02",
                "fecha_termino": "2026-06-30",
                "horas": 360,
                "cargo_funcion": "Desarrollador",
                "descripcion": "Practica de caracterizacion",
            },
        )


if __name__ == "__main__":
    unittest.main()
