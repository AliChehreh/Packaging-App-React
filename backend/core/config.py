from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_ENV: str = "dev"

    # Database URLs (loaded from .env)
    APP_DATABASE_URL: str | None = None
    OES_DATABASE_URL: str | None = None

    # Authentication settings
    SECRET_KEY: str = "your-secret-key-change-in-production"  # Change this in production
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 240  # 4 hours inactivity timeout

    # point to .env file
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
