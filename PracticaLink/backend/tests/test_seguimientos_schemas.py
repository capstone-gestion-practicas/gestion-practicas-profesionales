import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

from pydantic import ValidationError
from app.seguimientos.schemas import SeguimientoCreate, hoy_chile


class SeguimientoSchemasTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch('app.seguimientos.schemas.hoy_chile', return_value=date(2026, 10, 29)))
        self.body = {'fecha': '2026-10-29', 'tipo': 'Videollamada', 'observacion': ' Texto '}

    def test_calendar_and_all_media_preserve_observation(self):
        for medio in ['Reunión presencial', 'Videollamada', 'Llamada telefónica', 'Correo electrónico', 'Otro']:
            datos = SeguimientoCreate(**{**self.body, 'tipo': medio})
            self.assertEqual(datos.fecha, date(2026, 10, 29))
            self.assertEqual(datos.observacion, ' Texto ')

    def test_invalid_dates_and_no_timestamp_coercion(self):
        for value in [None, '', '2026-02-30', '2026-10-30', '2026-10-29T00:00:00Z',
                      '20261029', 0, False, datetime(2026, 10, 29), 'infinity']:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                SeguimientoCreate(**{**self.body, 'fecha': value})

    def test_unicode_limit_whitespace_and_types(self):
        self.assertEqual(len(SeguimientoCreate(**{**self.body, 'observacion': '📝'*2000}).observacion), 2000)
        for value in [None, '', '   ', '\t\n\r', 12, '📝'*2001, ' '+'a'*2000]:
            with self.subTest(length=len(value) if isinstance(value, str) else None), self.assertRaises(ValidationError):
                SeguimientoCreate(**{**self.body, 'observacion': value})

    def test_missing_fields_extra_author_and_invalid_medium(self):
        for key in self.body:
            with self.assertRaises(ValidationError):
                SeguimientoCreate(**{k: v for k, v in self.body.items() if k != key})
        for key in ['id_usuario', 'autor', 'id_practica', 'proxima_fecha']:
            with self.assertRaises(ValidationError):
                SeguimientoCreate(**{**self.body, key: 99})
        for value in [None, '', 'Correo', 'Otro ', 'videollamada']:
            with self.assertRaises(ValidationError):
                SeguimientoCreate(**{**self.body, 'tipo': value})

    def test_chile_day_at_utc_boundary_in_summer_and_winter(self):
        # Invocar referencia original, sin el mock de hoy_chile.
        with patch('app.seguimientos.schemas.datetime') as clock:
            for instant, expected in [
                (datetime(2026, 1, 2, 2, tzinfo=timezone.utc), date(2026, 1, 1)),
                (datetime(2026, 7, 2, 3, tzinfo=timezone.utc), date(2026, 7, 1)),
            ]:
                clock.now.side_effect = lambda zone: instant.astimezone(zone)
                self.assertEqual(hoy_chile(), expected)
