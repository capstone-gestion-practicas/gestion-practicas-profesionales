"""Local scheduled command: python -B -m app.informes.cleanup. No public HTTP route."""
from app.informes.database import get_informe_db
from app.informes.service import Informes
from app.informes.storage import Storage

if __name__ == '__main__':
    dependency = get_informe_db()
    try:
        result = Informes(next(dependency), Storage()).limpiar()
        print(f"Reservas procesadas: {result['procesadas']}; pendientes: {result['fallidas']}")
        if result['fallidas']:
            raise SystemExit(1)
    finally:
        dependency.close()
