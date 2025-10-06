from backend.db.session import AppSessionLocal, OesSessionLocal


# Dependency for App DB
def get_app_db():
    db = AppSessionLocal()
    try:
        yield db
    finally:
        db.close()


# Dependency for OES DB (read-only)
def get_oes_db():
    db = OesSessionLocal()
    try:
        yield db
    finally:
        db.close()
