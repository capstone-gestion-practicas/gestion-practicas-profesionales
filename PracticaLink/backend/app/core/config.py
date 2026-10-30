from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_database_url: str
    inicio_practica_database_url: str | None = None
    seguimientos_database_url: str | None = None

    seguimientos_lectura_database_url: str | None = None

    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60

    chile_rut_empresa_api_key: str | None = None
    chile_rut_empresa_api_url: str = "https://chilerutempresa.cl/api"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False
    )


settings = Settings()
