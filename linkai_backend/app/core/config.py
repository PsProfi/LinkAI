from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "LinkAI Backend"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    API_V1_STR: str = "/api/v1"

    # Server configuration
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # HTTPS & SSL configuration
    # За замовчуванням вимикаємо HTTPS для локальної розробки без .env,
    # щоб VS Code extension міг звертатись до бекенду без self-signed cert issues.
    HTTPS_ENABLED: bool = False
    SSL_KEYFILE: Optional[str] = None
    SSL_CERTFILE: Optional[str] = None
    SSL_CERT_DIR: str = "certs"

    # Security & JWT configuration
    JWT_SECRET_KEY: str = "linkai-super-secret-jwt-development-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30  # 30 days default

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "https://localhost:3000",
        "https://localhost:5173",
        "https://127.0.0.1:3000",
        "https://127.0.0.1:5173",
    ]

    # Supabase Credentials
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""

    # AI Provider selector: "openai" | "gemini"
    # При AI_PROVIDER="gemini" сервіс використовує Gemini як основний.
    # При AI_PROVIDER="openai" — OpenAI як основний з автоматичним fallback на Gemini
    # якщо OpenAI повертає 401 (вичерпаний баланс / невалідний ключ).
    AI_PROVIDER: str = "gemini"

    # OpenAI
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_TEMPERATURE: float = 0.4
    OPENAI_MAX_TOKENS: int = 1024

    # Google Gemini (через OpenAI-сумісний endpoint)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.6-flash"


    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

