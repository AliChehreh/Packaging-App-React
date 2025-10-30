from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

from backend.db.session import get_app_session
from backend.db.models import User, Role
from backend.core.auth import hash_password, verify_password
from backend.deps import get_current_active_user

router = APIRouter(prefix="/api/users", tags=["users"])


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=64, description="Username (3-64 characters)")
    password: str = Field(..., min_length=6, description="Password (minimum 6 characters)")
    role: Role = Field(..., description="User role")
    active: bool = Field(default=True, description="Whether user is active")


class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=64)
    role: Optional[Role] = None
    active: Optional[bool] = None


class UserPasswordReset(BaseModel):
    password: str = Field(..., min_length=6, description="New password (minimum 6 characters)")


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


def require_supervisor(current_user: User = Depends(get_current_active_user)):
    """Require supervisor role to access user management endpoints."""
    if current_user.role != Role.supervisor:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Supervisor access required"
        )
    return current_user


@router.get("/", response_model=List[UserResponse])
def list_users(
    db: Session = Depends(get_app_session),
    current_user: User = Depends(require_supervisor)
):
    """List all users (supervisor only)."""
    users = db.query(User).order_by(User.username).all()
    return users


@router.post("/", response_model=UserResponse)
def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_app_session),
    current_user: User = Depends(require_supervisor)
):
    """Create a new user (supervisor only)."""
    # Check if username already exists
    existing_user = db.query(User).filter(User.username == user_data.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists"
        )
    
    # Create new user
    hashed_password = hash_password(user_data.password)
    new_user = User(
        username=user_data.username,
        password_hash=hashed_password,
        role=user_data.role,
        active=1 if user_data.active else 0
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return new_user


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_app_session),
    current_user: User = Depends(require_supervisor)
):
    """Get user by ID (supervisor only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_data: UserUpdate,
    db: Session = Depends(get_app_session),
    current_user: User = Depends(require_supervisor)
):
    """Update user (supervisor only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent updating own account to inactive
    if user_id == current_user.id and user_data.active is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own account"
        )
    
    # Check username uniqueness if updating username
    if user_data.username and user_data.username != user.username:
        existing_user = db.query(User).filter(User.username == user_data.username).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already exists"
            )
    
    # Update fields
    if user_data.username is not None:
        user.username = user_data.username
    if user_data.role is not None:
        user.role = user_data.role
    if user_data.active is not None:
        user.active = 1 if user_data.active else 0
    
    db.commit()
    db.refresh(user)
    
    return user


@router.post("/{user_id}/reset-password", response_model=dict)
def reset_user_password(
    user_id: int,
    password_data: UserPasswordReset,
    db: Session = Depends(get_app_session),
    current_user: User = Depends(require_supervisor)
):
    """Reset user password (supervisor only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Update password
    user.password_hash = hash_password(password_data.password)
    db.commit()
    
    return {"message": "Password reset successfully"}


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_app_session),
    current_user: User = Depends(require_supervisor)
):
    """Delete user (supervisor only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent deleting own account
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )
    
    db.delete(user)
    db.commit()
    
    return {"message": "User deleted successfully"}


@router.post("/{user_id}/toggle-active", response_model=UserResponse)
def toggle_user_active(
    user_id: int,
    db: Session = Depends(get_app_session),
    current_user: User = Depends(require_supervisor)
):
    """Toggle user active status (supervisor only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent deactivating own account
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own account"
        )
    
    # Toggle active status
    user.active = 0 if user.active == 1 else 1
    db.commit()
    db.refresh(user)
    
    return user
