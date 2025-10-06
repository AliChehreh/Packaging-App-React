from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from backend.core.config import get_settings

settings = get_settings()

# --- Engines ---
app_engine = create_engine(
    str(settings.APP_DATABASE_URL),
    pool_pre_ping=True,
    future=True,
)

oes_engine = create_engine(
    str(settings.OES_DATABASE_URL),
    pool_pre_ping=True,
    future=True,
)

# --- Session factories ---
AppSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=app_engine,
    future=True,
)

OesSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=oes_engine,
    future=True,
)

# --- Base classes (for models) ---
AppBase = declarative_base()
OesBase = declarative_base()
from collections.abc import Generator
from sqlalchemy.orm import Session

def get_app_session() -> Generator[Session, None, None]:
    """FastAPI dependency: yield a DB session and make sure it closes."""
    db = AppSessionLocal()
    try:
        yield db
    finally:
        db.close()
def get_oes_session() -> Generator[Session, None, None]:
    """FastAPI dependency: yield a DB session and make sure it closes."""
    db = OesSessionLocal()
    try:
        yield db
    finally:
        db.close()