# libs/app/services/cartons.py
from typing import Iterable, Optional
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend.db.models import CartonType  # adjust if your CartonType lives elsewhere


def list_cartons(db: Session, *, active_only: bool = True) -> list[CartonType]:
    stmt = select(CartonType)
    if active_only:
        stmt = stmt.where(CartonType.active == True)  # noqa: E712
    return list(db.execute(stmt).scalars().all())


def create_carton(db: Session, *, name: Optional[str], length_in: Optional[int],
                  width_in: Optional[int], height_in: Optional[int],
                  max_weight_lb: int = 99, style: Optional[str] = None,
                  vendor: Optional[str] = None, minimum_stock: int = 0,
                  active: bool = True) -> CartonType:
    c = CartonType(
        name=name,
        length_in=length_in, width_in=width_in, height_in=height_in,
        max_weight_lb=int(max_weight_lb) if max_weight_lb is not None else 99,
        style=style, vendor=vendor,
        minimum_stock=int(minimum_stock or 0),
        active=bool(active),
    )
    # quantity_on_hand comes from the DB default (0)
    db.add(c)
    db.flush()
    return c


def update_carton(db: Session, carton_id: int, **fields) -> CartonType:
    c = db.get(CartonType, carton_id)
    if not c:
        raise ValueError("carton_type not found")
    for k, v in fields.items():
        if hasattr(c, k):
            setattr(c, k, v)
    db.flush()
    return c


def adjust_inventory(db: Session, carton_id: int, delta: int) -> CartonType:
    c = db.get(CartonType, carton_id)
    if not c:
        raise ValueError("carton_type not found")
    c.quantity_on_hand = int(c.quantity_on_hand or 0) + int(delta)
    db.flush()
    return c