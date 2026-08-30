from fastapi import FastAPI
from sqlalchemy import text

from app.core.database import engine
from app.api.routes.auth import router as auth_router


app = FastAPI(
    title="PracticaLink API",
    version="0.1.0"
)

app.include_router(auth_router)


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