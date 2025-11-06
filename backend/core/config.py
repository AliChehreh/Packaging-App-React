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

    # UPS API credentials
    UPS_CLIENT_ID: str | None = None
    UPS_CLIENT_SECRET: str | None = None
    UPS_ACCOUNT_NUMBER: str | None = None  # 6-digit UPS account number (e.g., "02243E")
    UPS_USE_PRODUCTION: bool = True  # Set to True to use production endpoint, False for CIE (testing)
    
    # Ship-from address for UPS
    UPS_SHIP_FROM_NAME: str | None = None
    UPS_SHIP_FROM_ADDRESS1: str | None = None
    UPS_SHIP_FROM_ADDRESS2: str | None = None
    UPS_SHIP_FROM_CITY: str | None = None
    UPS_SHIP_FROM_PROVINCE: str | None = None
    UPS_SHIP_FROM_POSTAL_CODE: str | None = None
    UPS_SHIP_FROM_COUNTRY: str = "CA"  # Default to Canada based on example

    # point to .env file
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
