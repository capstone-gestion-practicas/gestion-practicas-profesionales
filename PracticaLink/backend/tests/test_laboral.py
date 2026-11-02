import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql+psycopg://localhost/practicalink_test")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.main import app
from app.laboral.schemas import SolicitudCuentaEmpresaRequest


class LaboralRoutesTests(unittest.TestCase):
    def setUp(self):
        self.overrides = dict(app.dependency_overrides)
        self.addCleanup(self.restore_overrides)
        self.db = MagicMock()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user_id] = lambda: 23
        self.contexto = self.enterContext(patch(
            "app.core.permissions.obtener_contexto_usuario",
            return_value={"roles": ["ESTUDIANTE"]},
        ))
        self.enterContext(patch(
            "sqlalchemy.engine.Engine.connect",
            side_effect=AssertionError("Conexión real prohibida"),
        ))
        self.client = self.enterContext(TestClient(app))

    def restore_overrides(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)

    def test_student_lists_public_offers_with_authenticated_identity(self):
        oferta = {
            "id_oferta": 7,
            "rut_empresa": "76.123.456-0",
            "empresa": "Empresa Sintética",
            "cargo": "Analista",
            "descripcion": "Descripción suficientemente extensa",
            "ubicacion": "Santiago",
            "modalidad": "HIBRIDA",
            "requisitos": "Experiencia",
            "jornada": "COMPLETA",
            "fecha_publicacion": "2026-11-02T12:00:00Z",
            "fecha_cierre": None,
            "estado": "PUBLICADA",
            "total_postulaciones": 2,
        }
        self.db.execute.return_value.scalar_one.return_value = [oferta]

        response = self.client.get("/laboral/ofertas")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [oferta])
        self.assertIn("fn_laboral_listar_ofertas", str(self.db.execute.call_args.args[0]))
        self.assertEqual(self.db.execute.call_args.args[1], {
            "id_usuario": 23, "solo_publicadas": True
        })

    def test_company_practice_list_is_scoped_to_authenticated_account(self):
        practice = {
            "id_practica": 15,
            "rut_empresa": "76.123.456-0",
            "centro_practica": "Centro Sintético",
            "estado": "EN_CURSO",
            "fecha_inicio": "2026-03-01",
            "fecha_termino": None,
            "cargo_funcion": "Desarrollador",
            "estudiante": {
                "nombre": "Estudiante",
                "apellido": "Sintético",
                "correo": "student@example.invalid",
                "rut": "12.345.678-5",
                "carrera": "Informática",
                "sede": "Alameda",
                "telefono": None,
            },
        }
        self.contexto.return_value = {"roles": ["EMPRESA"]}
        self.db.execute.return_value.scalar_one.return_value = [practice]

        response = self.client.get("/laboral/practicas")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [practice])
        self.assertEqual(self.db.execute.call_args.args[1], {"id_usuario": 23})
        self.assertIn("fn_laboral_practicas_empresa", str(self.db.execute.call_args.args[0]))

    def test_company_account_rut_comes_from_authenticated_account(self):
        self.contexto.return_value = {"roles": ["EMPRESA"]}
        self.db.execute.return_value.scalar_one_or_none.return_value = "76.123.456-0"

        response = self.client.get("/laboral/empresa/cuenta")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"rut_empresa": "76.123.456-0"})
        self.assertEqual(self.db.execute.call_args.args[1], {"id_usuario": 23})

    def test_student_cannot_read_company_practice_list(self):
        response = self.client.get("/laboral/practicas")

        self.assertEqual(response.status_code, 403)
        self.db.execute.assert_not_called()

    def test_duplicate_application_returns_conflict_and_rolls_back(self):
        self.db.execute.return_value.scalar_one.return_value = {
            "error": "POSTULACION_DUPLICADA"
        }

        response = self.client.post(
            "/laboral/ofertas/7/postulaciones",
            json={"carta_presentacion": "Me interesa la oferta"},
        )

        self.assertEqual(response.status_code, 409)
        self.db.rollback.assert_called_once()
        self.db.commit.assert_not_called()

    def test_application_uses_authenticated_student_and_commits(self):
        self.db.execute.return_value.scalar_one.return_value = {
            "id_postulacion": 44,
            "estado": "RECIBIDA",
            "mensaje": "Postulación enviada correctamente",
        }

        response = self.client.post(
            "/laboral/ofertas/7/postulaciones",
            json={"carta_presentacion": "  Me interesa  "},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["id_postulacion"], 44)
        self.assertEqual(self.db.execute.call_args.args[1], {
            "id_usuario": 23,
            "id_oferta": 7,
            "carta_presentacion": "Me interesa",
        })
        self.db.commit.assert_called_once()

    def test_company_cannot_create_application(self):
        self.contexto.return_value = {"roles": ["EMPRESA"]}

        response = self.client.post(
            "/laboral/ofertas/7/postulaciones", json={}
        )

        self.assertEqual(response.status_code, 403)
        self.db.execute.assert_not_called()

    def test_invalid_offer_request_is_rejected_before_database_call(self):
        self.contexto.return_value = {"roles": ["GESTOR"]}
        response = self.client.post(
            "/laboral/ofertas",
            json={
                "cargo": "A",
                "descripcion": "corta",
                "ubicacion": "Santiago",
                "modalidad": "HIBRIDA",
                "requisitos": "Sí",
                "jornada": "COMPLETA",
                "estado": "PUBLICADA",
            },
        )

        self.assertEqual(response.status_code, 422)
        self.db.execute.assert_not_called()

    def test_company_request_is_public_and_stores_only_validated_fields(self):
        resultado = {
            "id_solicitud": 41,
            "estado": "PENDIENTE",
            "mensaje": "Solicitud enviada para revisión",
        }
        with patch(
            "app.laboral.routes.crear_solicitud_empresa", return_value=resultado
        ) as crear:
            response = self.client.post("/laboral/solicitudes-empresa", json={
                "razon_social": "Empresa Sintética",
                "rut_empresa": "76123456-0",
                "nombre_contacto": "Ana",
                "apellido_contacto": "Prueba",
                "correo": "ana@example.com",
                "telefono": "+56912345678",
                "cargo_contacto": "Encargada de personas",
                "password": "synthetic-password",
            })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), resultado)
        self.assertEqual(crear.call_args.args[1].rut_empresa, "76.123.456-0")

    def test_company_request_rejects_invalid_rut_before_database_call(self):
        response = self.client.post("/laboral/solicitudes-empresa", json={
            "razon_social": "Empresa Sintética",
            "rut_empresa": "76.123.456-1",
            "nombre_contacto": "Ana",
            "apellido_contacto": "Prueba",
            "correo": "ana@example.com",
            "telefono": "+56912345678",
            "cargo_contacto": "Encargada de personas",
            "password": "synthetic-password",
        })

        self.assertEqual(response.status_code, 422)
        self.db.execute.assert_not_called()

    def test_company_lookup_is_public_and_returns_provider_data(self):
        resultado = {
            "found": True,
            "rut": "76.123.456-0",
            "dv": "0",
            "razon_social": "Empresa Sintética",
        }
        with patch(
            "app.laboral.routes.consultar_empresa", return_value=resultado
        ) as consultar:
            response = self.client.get(
                "/laboral/solicitudes-empresa/consulta/76.123.456-0"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["razon_social"], "Empresa Sintética")
        consultar.assert_called_once_with(self.db, "76.123.456-0")

    def test_admin_lists_company_requests(self):
        self.contexto.return_value = {"roles": ["ADMINISTRADOR"]}
        with patch(
            "app.laboral.routes.listar_solicitudes_empresa", return_value=[]
        ) as listar:
            response = self.client.get("/laboral/solicitudes-empresa")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])
        listar.assert_called_once_with(self.db, 23)

    def test_non_admin_cannot_list_company_requests(self):
        response = self.client.get("/laboral/solicitudes-empresa")

        self.assertEqual(response.status_code, 403)

    def test_admin_approval_creates_company_account(self):
        self.contexto.return_value = {"roles": ["ADMINISTRADOR"]}
        resultado = {
            "id_solicitud": 41,
            "id_usuario": 62,
            "estado": "APROBADA",
            "mensaje": "Solicitud aprobada y cuenta empresa creada",
        }
        with patch(
            "app.laboral.routes.resolver_solicitud_empresa",
            return_value=resultado,
        ) as resolver:
            response = self.client.patch(
                "/laboral/solicitudes-empresa/41",
                json={"estado": "APROBADA", "observacion": "Validada"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), resultado)
        self.assertEqual(resolver.call_args.args[1:3], (23, 41))

    def test_admin_can_reject_company_request(self):
        self.contexto.return_value = {"roles": ["ADMINISTRADOR"]}
        resultado = {
            "id_solicitud": 41,
            "estado": "RECHAZADA",
            "mensaje": "Solicitud rechazada",
        }
        with patch(
            "app.laboral.routes.resolver_solicitud_empresa",
            return_value=resultado,
        ):
            response = self.client.patch(
                "/laboral/solicitudes-empresa/41",
                json={"estado": "RECHAZADA", "observacion": "Datos incompletos"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["estado"], "RECHAZADA")

    def test_company_request_schema_normalizes_rut_and_email(self):
        request = SolicitudCuentaEmpresaRequest(
            razon_social=" Empresa Sintética ",
            rut_empresa="76123456-0",
            nombre_contacto=" Ana ",
            apellido_contacto=" Prueba ",
            correo=" ANA@EXAMPLE.COM ",
            telefono=" +56912345678 ",
            cargo_contacto=" Encargada ",
            password="synthetic-password",
        )

        self.assertEqual(request.rut_empresa, "76.123.456-0")
        self.assertEqual(request.correo, "ana@example.com")
        self.assertEqual(request.razon_social, "Empresa Sintética")
