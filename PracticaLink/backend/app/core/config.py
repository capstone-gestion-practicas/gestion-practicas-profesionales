from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_database_url: str
    inicio_practica_database_url: str | None = None

    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60

    # Supabase Realtime token signing key (the project's JWT signing secret).
    # Keep this server-side; never expose it to the frontend.
    supabase_jwt_secret: str | None = None

    # Firebase service account JSON used to send Android push notifications.
    firebase_service_account_json: str | None = None

    chile_rut_empresa_api_key: str | None = None
    chile_rut_empresa_api_url: str = "https://chilerutempresa.cl/api"

    smtp_host: str = "127.0.0.1"
    smtp_port: int = 54325
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "noreply@practicalink.local"
    smtp_use_tls: bool = False

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False
    )


settings = Settings()
