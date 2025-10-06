from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from backend.db.session import get_app_session as get_db
from backend.db import models , oes_read
from backend.services import pack_view

router = APIRouter(prefix="/api/pack", tags=["pack"])

@router.get("/{pack_id}")
def get_pack_snapshot(pack_id: int, db: Session = Depends(get_db)):
    """
    Return the full pack snapshot (header, lines, boxes, items).
    Used by the workspace view after Start Pack.
    """
    try:
        return pack_view.get_pack_snapshot(db, pack_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.post("/start")
def start_pack(payload: dict, db: Session = Depends(get_db)):
    """
    Ensure an order exists locally (import if needed) and start/reuse a pack.
    Returns {pack_id, order_no, status}.
    """
    order_no = str(payload.get("order_no", "")).strip()
    if not order_no:
        raise HTTPException(400, "Missing order_no")

    # 1. Try to find order locally
    order = db.execute(
        db.query(models.Order).where(models.Order.order_no == order_no)
    ).scalar_one_or_none()

    # 2. Import from OES if missing
    if not order:
        header, lines = oes_read.fetch_order_from_oes(order_no)
        if not header:
            raise HTTPException(404, f"OES order {order_no} not found")

        # Create Order
        order = models.Order(
            order_no=header["order_no"],
            customer_name=header.get("customer_name"),
            ship_to=header.get("ship_to"),
            due_date=header.get("due_date"),
            lead_time_plan=header.get("lead_time_plan"),
            source="OES",
        )
        db.add(order)
        db.flush()  # to get order.id

        # Create Order Lines
        for l in lines:
            db.add(
                models.OrderLine(
                    order_id=order.id,
                    product_code=l["product_code"],
                    length_in=round(float(l["length_in"] or 0)),
                    height_in=round(float(l["height_in"] or 0)),
                    qty_ordered=int(l["qty_ordered"] or 0),
                    finish=l.get("finish"),
                )
            )
        db.commit()

    # 3. Reuse or create pack
    pack = (
        db.query(models.Pack)
        .filter(models.Pack.order_id == order.id, models.Pack.status == "in_progress")
        .first()
    )
    if not pack:
        pack = models.Pack(order_id=order.id, status="in_progress")
        db.add(pack)
        db.commit()
        db.refresh(pack)

    return {"pack_id": pack.id, "order_no": order_no, "status": pack.status}

# ---------------------------------------------------------------------
# Create box input model
# ---------------------------------------------------------------------
class CreateBoxIn(BaseModel):
    carton_type_id: int | None = None
    length_in: int | None = None
    width_in: int | None = None
    height_in: int | None = None
    max_weight_lb: int | None = Field(default=None, ge=1)


def _next_box_no(db: Session, pack_id: int) -> int:
    q = select(func.coalesce(func.max(models.PackBox.box_no), 0)).where(models.PackBox.pack_id == pack_id)
    return int(db.execute(q).scalar_one()) + 1


# ---------------------------------------------------------------------
# Create box
# ---------------------------------------------------------------------
@router.post("/{pack_id}/boxes")
def create_box(pack_id: int, body: CreateBoxIn, db: Session = Depends(get_db)):
    pack = db.get(models.Pack, pack_id)
    if not pack:
        raise HTTPException(404, "Pack not found")

    pb = models.PackBox(pack_id=pack_id)

    if body.carton_type_id:
        ct = db.get(models.CartonType, body.carton_type_id)
        if not ct or not getattr(ct, "active", True):
            raise HTTPException(400, "Invalid or inactive carton_type_id")
        pb.carton_type_id = ct.id
        pb.max_weight_lb = int(body.max_weight_lb or getattr(ct, "max_weight_lb", 40))
    else:
        if not all([body.length_in, body.width_in, body.height_in]):
            raise HTTPException(400, "Provide either carton_type_id or custom length/width/height")
        if body.length_in is None or body.width_in is None or body.height_in is None:
            raise HTTPException(400, "Custom length, width, and height must be provided")
        pb.custom_l_in = int(body.length_in)
        pb.custom_w_in = int(body.width_in)
        pb.custom_h_in = int(body.height_in)
        pb.max_weight_lb = int(body.max_weight_lb or 40)

    for _ in range(3):
        pb.box_no = _next_box_no(db, pack_id)
        db.add(pb)
        try:
            db.commit()
            db.refresh(pb)
            return {"id": pb.id, "pack_id": pb.pack_id, "box_no": pb.box_no}
        except IntegrityError:
            db.rollback()
    raise HTTPException(409, "Could not allocate unique box number; retry")


# ---------------------------------------------------------------------
# Mark pack complete
# ---------------------------------------------------------------------
@router.post("/{pack_id}/complete")
def complete_pack(pack_id: int, db: Session = Depends(get_db)):
    try:
        pack_view.complete_pack(db, pack_id)
        return {"status": "complete"}
    except ValueError as e:
        raise HTTPException(400, str(e))
