# Revisión focalizada de 15 fallos y 4 errores

No se corrigieron tests ni producción. Se revisaron el log de la suite existente
(522 pruebas, 15 failures/4 errors), fixtures, servicios, schemas y SQL versionado.
Además se consultaron en lectura siete firmas/tipos remotos: todas devuelven jsonb;
crear/actualizar usuario contienen ROLES_INVALIDOS y no SIN_ROLES. El laboratorio
con PostgreSQL real verificó listas JSONB y esos errores sin usar mocks.

| Grupo / resultados | Causa comprobada | Relevancia y corrección propuesta |
| --- | --- | --- |
| test_empresas: 2 fallos | Aserción SQL espera función sin public.; producción usa public.fn_obtener_empresa_cache | Expectativa obsoleta. Conservar calificación de esquema y assertions de parámetros/cache/commit. Lookup empresarial depende además de API/cache; no probar proveedor real sin autorización. |
| test_estudiantes: 1 fallo | Espera fn_completar_perfil_estudiante sin public. | Expectativa obsoleta. Importante para inscripción; preservar identidad JWT y JSON enviado. |
| test_practicas_service: 4 errores | Fixture dict omite horas_semanales y genera KeyError | Consulta real SELECT p.horas_semanales (service.py:124/173); columna remota existe. Añadir valor/None al fixture, conservar orden/historial/autorización. No ocultar errores con dict.get en producción para arreglar mocks. |
| test_practicas: 2 fallos | JSON esperado omite campos actuales horas_semanales/fecha_ultimo_cambio_estado | Contrato opcional válido en schemas.py; actualizar expectativas, mantener validación de datos/fechas. |
| test_practicas_schemas: 1 fallo | JSON esperado omite horas_semanales=None | Fixture obsoleto; no cambiar serialización de producción. |
| test_usuarios: 5 fallos (2 rutas + 3 servicios) | Mocks de mappings().all() frente a scalar_one() que consume jsonb | PostgreSQL y endpoints usan JSONB agregado/lista; scalar_one correcto. Mocks tipados coherentes, conservar listas vacías/roles activos/secretos excluidos. |
| test_usuarios: 4 fallos (2 rutas + 2 servicios, caso SIN_ROLES) | Esperan excepción/400 para un código SQL que no emiten las funciones vigentes | Usar ROLES_INVALIDOS para ese caso y preservar tests de autorización/rollback. No modificar servicios para satisfacer un protocolo ficticio. |

Total: 15 fallos y 4 errores. Son deuda de tests frente al contrato vigente, no 19
regresiones funcionales demostradas. Usuarios/perfil/prácticas son relevantes al
ciclo y conviene corregir sus fixtures en una tarea separada; no eliminar pruebas.
La coincidencia de tipos no prueba todos los escenarios HTTP de cuentas reales.
La integración académica ejecutada sí utiliza FastAPI/PostgreSQL reales y logins
restringidos, pero simula Storage/push y firma JWT sintéticos (no login humano/UI).
Ningún resultado se presenta como validación del navegador autenticado compartido.
