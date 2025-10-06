# backend/api/health.py
from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["system"])

@router.get("/health")
def health_check():
    """Simple heartbeat endpoint for uptime checks."""
    return {"status": "ok"}
