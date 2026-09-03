from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.database import engine
from app.auth.routes import router as auth_router
from app.api.routes.practicas import router as practicas_router
from app.api.routes.estudiantes import router as estudiantes_router
from app.api.routes.revisiones import router as revisiones_router
from app.api.routes.usuarios import router as usuarios_router

app = FastAPI(
    title="PracticaLink API",
    version="0.1.0"
)

# CORS para permitir conexión desde Angular/Ionic
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",
        "http://127.0.0.1:4200",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(practicas_router)
app.include_router(estudiantes_router)
app.include_router(revisiones_router)
app.include_router(usuarios_router)


@app.get("/")
def root():
    return {
        "app": "PracticaLink API",
        "status": "ok"
    }


@app.get("/health/database")
def database_health():
    with engine.connect() as connection:
        result = connection.execute(
            text("""
                SELECT
                    current_database(),
                    current_user,
                    NOW()
            """)
        ).fetchone()

    return {
        "database": result[0],
        "user": result[1],
        "server_time": result[2]
    }
