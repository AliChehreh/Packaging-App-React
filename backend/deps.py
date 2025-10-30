from fastapi import Depends, HTTPException, status, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import Optional

from backend.db.session import AppSessionLocal, OesSessionLocal
from backend.db.models import User, Role
from backend.core.auth import decode_token

security = HTTPBearer(auto_error=False)


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


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_app_db),
    token: Optional[str] = Query(None)
) -> User:
    """Get current authenticated user from JWT token.
    Accepts token from Authorization header or query parameter (for window.open compatibility)."""
    # Try to get token from Authorization header first
    auth_token = None
    if credentials:
        auth_token = credentials.credentials
    
    # Fallback to query parameter if no header token (for window.open)
    if not auth_token and token:
        auth_token = token
    
    if not auth_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    payload = decode_token(auth_token)
    
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    username: str = payload.get("sub")
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """Get current active user (ensures user is active)."""
    if current_user.active != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    return current_user


def require_supervisor(current_user: User = Depends(get_current_active_user)) -> User:
    """Require supervisor role to access certain endpoints."""
    if current_user.role != Role.supervisor:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Supervisor access required"
        )
    return current_user
