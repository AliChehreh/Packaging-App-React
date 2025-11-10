# apps/api/cartons.py
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

# ✅ DB session dependency (adjust this import if your project exposes it elsewhere)
from backend.db.session import get_app_session as get_db

from backend.services import cartons as svc
from backend.deps import get_current_active_user

router = APIRouter(prefix="/api/cartons", tags=["cartons"])


class CartonIn(BaseModel):
    name: str | None = None
    length_in: int | None = None
    width_in: int | None = None
    height_in: int | None = None
    max_weight_lb: int = Field(default=99, ge=1)
    style: str | None = Field(default=None, max_length=20)
    vendor: str | None = Field(default=None, max_length=64)
    minimum_stock: int = Field(default=0, ge=0)
    active: bool = True


class CartonOut(CartonIn):
    id: int
    quantity_on_hand: int

    class Config:
        from_attributes = True  # allow SQLAlchemy model -> Pydantic


class AdjustIn(BaseModel):
    delta: int  # positive or negative


@router.get("", response_model=list[CartonOut])
def list_cartons(active_only: bool = Query(True), db: Session = Depends(get_db), current_user = Depends(get_current_active_user)):
    return svc.list_cartons(db, active_only=active_only)


@router.post("", response_model=CartonOut)
def create_carton(payload: CartonIn, db: Session = Depends(get_db), current_user = Depends(get_current_active_user)):
    try:
        c = svc.create_carton(db, **payload.model_dump())
        db.commit()
        db.refresh(c)
        return c
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{carton_id}", response_model=CartonOut)
def update_carton(carton_id: int, payload: CartonIn, db: Session = Depends(get_db), current_user = Depends(get_current_active_user)):
    try:
        c = svc.update_carton(db, carton_id, **payload.model_dump())
        db.commit()
        db.refresh(c)
        return c
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{carton_id}/adjust", response_model=CartonOut)
def adjust_inventory(carton_id: int, payload: AdjustIn, db: Session = Depends(get_db), current_user = Depends(get_current_active_user)):
    try:
        c = svc.adjust_inventory(db, carton_id, payload.delta)
        db.commit()
        db.refresh(c)
        return c
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(e))
