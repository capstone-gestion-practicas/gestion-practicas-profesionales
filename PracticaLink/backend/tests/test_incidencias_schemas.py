import unittest
from pydantic import ValidationError
from app.incidencias.schemas import IncidenciaCreate, IncidenciaCreateResponse
from tests.test_incidencias_service import exito


class IncidenciaSchemasTests(unittest.TestCase):
    def test_types_and_unicode_limit_preserve_description(self):
        for tipo in ('ABANDONO', 'PROBLEMA_CENTRO', 'SALUD', 'OTRO'):
            for descripcion in (' Texto ', '😀'*2000):
                self.assertEqual(IncidenciaCreate(tipo=tipo, descripcion=descripcion).descripcion, descripcion)

    def test_invalid_description_and_types(self):
        for description in (None, '', ' \t\n', 'á'*2001, 123, [], True):
            with self.assertRaises(ValidationError):
                IncidenciaCreate(tipo='SALUD', descripcion=description)
        for tipo in (None, 'Salud', '', 12):
            with self.assertRaises(ValidationError):
                IncidenciaCreate(tipo=tipo, descripcion='Texto')

    def test_closed_input_contract(self):
        for key in ('id_usuario', 'id_autor', 'fecha', 'estado', 'prioridad'):
            with self.assertRaises(ValidationError):
                IncidenciaCreate.model_validate({'tipo':'SALUD', 'descripcion':'Texto', key:'no admitido'})

    def test_response_requires_pending_and_aware_date(self):
        self.assertEqual(IncidenciaCreateResponse.model_validate(exito()).estado, 'PENDIENTE')
        for key, value in [('estado','RESUELTA'), ('fecha','2026-10-30T12:00:00'), ('id_usuario',True)]:
            with self.assertRaises(ValidationError):
                IncidenciaCreateResponse.model_validate({**exito(),key:value})
