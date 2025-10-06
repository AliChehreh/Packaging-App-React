from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_ENV: str = "dev"

    # Database URLs (loaded from .env)
    APP_DATABASE_URL: str | None = None
    OES_DATABASE_URL: str | None = None

    # point to .env file
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
