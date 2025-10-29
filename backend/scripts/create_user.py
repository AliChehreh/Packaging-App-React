#!/usr/bin/env python3
"""
Simple script to create users in the database.
Usage: python -m backend.scripts.create_user <username> <password> <role>
Role options: packager, supervisor
"""
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.db.session import AppSessionLocal
from backend.db.models import User, Role
from backend.core.auth import hash_password

def create_user(username: str, password: str, role: str):
    """Create a user in the database."""
    # Validate password length before processing (bcrypt has 72 byte limit)
    password_bytes = password.encode('utf-8')
    if len(password_bytes) > 72:
        print(f"Error: Password cannot be longer than 72 bytes. Your password is {len(password_bytes)} bytes.")
        print("Please use a shorter password.")
        return False
    
    if not username or not username.strip():
        print("Error: Username cannot be empty.")
        return False
    
    if len(username) > 64:
        print("Error: Username cannot be longer than 64 characters.")
        return False
    
    db = AppSessionLocal()
    try:
        # Check if user already exists
        existing = db.query(User).filter(User.username == username).first()
        if existing:
            print(f"User '{username}' already exists!")
            return False
        
        # Validate role
        try:
            user_role = Role(role.lower())
        except ValueError:
            print(f"Invalid role: {role}. Must be 'packager' or 'supervisor'")
            return False
        
        # Create user
        password_hash = hash_password(password)
        user = User(
            username=username,
            password_hash=password_hash,
            role=user_role,
            active=1
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        
        print(f"User '{username}' created successfully with role '{role}'")
        return True
    except Exception as e:
        db.rollback()
        print(f"Error creating user: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python -m backend.scripts.create_user <username> <password> <role>")
        print("Role options: packager, supervisor")
        sys.exit(1)
    
    username = sys.argv[1]
    password = sys.argv[2]
    role = sys.argv[3]
    
    success = create_user(username, password, role)
    sys.exit(0 if success else 1)

