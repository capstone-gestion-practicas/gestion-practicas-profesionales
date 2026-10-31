import unittest
from datetime import date, datetime

from app.practicas.schemas import (
    CentroPracticaLectura,
    EstadoPracticaLectura,
    PracticaDetalleResponse,
)


class PracticaDetalleResponseTests(unittest.TestCase):
    def test_builds_with_representative_payload(self) -> None:
        model = PracticaDetalleResponse(
            id_practica=101,
            fecha_registro=datetime(2026, 9, 1, 10, 30, 0),
            estado={
                "id_estado": 1,
                "nombre": "REGISTRADA",
                "es_final": False,
            },
            centro_practica={
                "id_centro": 22,
                "nombre": "Centro de prueba",
                "rut_empresa": "12.345.678-5",
                "direccion": "Av. Siempre Viva 123",
                "telefono": "+56 9 1234 5678",
                "correo": "contacto@empresa.cl",
                "contacto_nombre": "Maria Perez",
                "contacto_cargo": "Jefa de practica",
            },
            fecha_inicio=date(2026, 3, 2),
            fecha_termino=date(2026, 6, 30),
            horas=360,
            cargo_funcion="Desarrollador",
            descripcion="Practica de caracterizacion",
        )

        self.assertEqual(model.estado.nombre, "REGISTRADA")
        self.assertEqual(model.centro_practica.nombre, "Centro de prueba")
        self.assertEqual(model.fecha_inicio, date(2026, 3, 2))
        self.assertEqual(model.horas, 360)

    def test_accepts_optional_fields_as_null_when_not_available(self) -> None:
        model = PracticaDetalleResponse(
            id_practica=202,
            fecha_registro=datetime(2026, 9, 1, 10, 30, 0),
            estado=EstadoPracticaLectura(
                id_estado=2,
                nombre="EN_REVISION",
                es_final=False,
            ),
            centro_practica=CentroPracticaLectura(
                id_centro=33,
                nombre="Centro sin datos extra",
            ),
            fecha_inicio=None,
            fecha_termino=None,
            horas=None,
            cargo_funcion=None,
            descripcion=None,
        )

        self.assertIsNone(model.centro_practica.rut_empresa)
        self.assertIsNone(model.fecha_inicio)
        self.assertIsNone(model.descripcion)

    def test_serializes_nested_structure_as_expected(self) -> None:
        model = PracticaDetalleResponse(
            id_practica=303,
            fecha_registro=datetime(2026, 9, 1, 10, 30, 0),
            estado={
                "id_estado": 3,
                "nombre": "REGISTRADA",
                "es_final": False,
            },
            centro_practica={
                "id_centro": 44,
                "nombre": "Centro de prueba",
                "rut_empresa": "12.345.678-5",
                "direccion": "Av. Siempre Viva 123",
                "telefono": "+56 9 1234 5678",
                "correo": "contacto@empresa.cl",
                "contacto_nombre": "Maria Perez",
                "contacto_cargo": "Jefa de practica",
            },
            fecha_inicio=date(2026, 3, 2),
            fecha_termino=date(2026, 6, 30),
            horas=360,
            cargo_funcion="Desarrollador",
            descripcion="Practica de caracterizacion",
        )

        self.assertEqual(
            model.model_dump(mode="json"),
            {
                "id_practica": 303,
                "fecha_registro": "2026-09-01T10:30:00",
                "estado": {
                    "id_estado": 3,
                    "nombre": "REGISTRADA",
                    "es_final": False,
                },
                "centro_practica": {
                    "id_centro": 44,
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
