# backend/api/orders.py
from datetime import date, datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_, desc, asc, func
from sqlalchemy.orm import Session

from backend.db.session import get_app_session, get_oes_session
from backend.db.models import Order as OrderModel, OrderLine as OrderLineModel
from backend.services.orders import ensure_order_in_app
from backend.deps import get_current_active_user

router = APIRouter(prefix="/api", tags=["orders"])


# ---------------------------
# Pydantic response schemas
# ---------------------------
class OrderLine(BaseModel):
    id: int
    # Convenience mirror for UI; we’ll fill it with the same value as `id`
    line_id: Optional[int] = None
    product_code: Optional[str] = None
    qty_ordered: int
    length_in: int
    height_in: int
    finish: Optional[str] = None
    build_note: Optional[str] = None
    product_tag: Optional[str] = None

    class Config:
        from_attributes = True  # Pydantic v1 compat; v2 shim also supports this


class Order(BaseModel):
    id: int
    order_no: str
    customer_name: Optional[str] = None
    ship_to: Optional[str] = None
    due_date: Optional[date] = None
    lead_time_plan: Optional[str] = None
    source: Optional[str] = "OES"
    total_lines: Optional[int] = 0
    total_qty: Optional[int] = 0
    created_at: Optional[datetime] = None
    status: Optional[str] = None  # present if your model has it

    class Config:
        from_attributes = True


class SyncOrderRequest(BaseModel):
    order_no: str


class SyncTotals(BaseModel):
    lines: int
    qty: int


class SyncOrderResponse(BaseModel):
    order: Order
    totals: SyncTotals
    imported: bool


# ---------------------------
# Routes
# ---------------------------

@router.get("/orders", response_model=List[Order])
def list_orders(
    q: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    sort: str = "-created_at",
    limit: int = 500,
    db: Session = Depends(get_app_session),
    current_user = Depends(get_current_active_user),
):
    """
    Return all matching orders in one shot (no pagination).
    'limit' is a safety cap (default 500, max 2000).
    """
    limit = max(1, min(limit, 2000))

    qry = db.query(OrderModel)

    # Free-text search
    if q:
        like = f"%{q}%"
        qry = qry.filter(
            or_(
                OrderModel.order_no.ilike(like),
                OrderModel.customer_name.ilike(like),
                OrderModel.ship_to.ilike(like),
            )
        )

    # Optional status filter (only if the column exists)
    if status and hasattr(OrderModel, "status"):
        qry = qry.filter(OrderModel.status == status)

    # Date range on due_date
    if date_from:
        qry = qry.filter(OrderModel.due_date >= date_from)
    if date_to:
        qry = qry.filter(OrderModel.due_date <= date_to)

    # Sorting whitelist
    allowed = {"created_at", "due_date", "order_no", "id"}
    fields = [f.strip() for f in sort.split(",") if f.strip()] or ["-created_at"]

    order_by_clauses = []
    for f in fields:
        direction = desc if f.startswith("-") else asc
        name = f.lstrip("+-")
        if name in allowed and hasattr(OrderModel, name):
            order_by_clauses.append(direction(getattr(OrderModel, name)))
    if not order_by_clauses:
        # Fallback if created_at not present
        order_by_clauses = [desc(getattr(OrderModel, "created_at", OrderModel.id))]

    items: List[OrderModel] = (
        qry.order_by(*order_by_clauses)
           .limit(limit)
           .all()
    )

    # Attach totals if not stored on the model (Pylance-friendly maps)
    if items:
        order_ids = [int(o.id) for o in items]

        qty_rows = (
            db.query(
                OrderLineModel.order_id,
                func.coalesce(func.sum(OrderLineModel.qty_ordered), 0),
            )
            .filter(OrderLineModel.order_id.in_(order_ids))
            .group_by(OrderLineModel.order_id)
            .all()
        )
        qty_map: dict[int, int] = {int(order_id): int(qty or 0) for (order_id, qty) in qty_rows}

        count_rows = (
            db.query(
                OrderLineModel.order_id,
                func.count(),
            )
            .filter(OrderLineModel.order_id.in_(order_ids))
            .group_by(OrderLineModel.order_id)
            .all()
        )
        line_count_map: dict[int, int] = {int(order_id): int(cnt or 0) for (order_id, cnt) in count_rows}

        for o in items:
            if not getattr(o, "total_lines", None):
                o.total_lines = int(line_count_map.get(int(o.id), 0))
            if not getattr(o, "total_qty", None):
                o.total_qty = int(qty_map.get(int(o.id), 0))

    return items


@router.post("/orders/sync", response_model=SyncOrderResponse)
def sync_order(payload: SyncOrderRequest, db: Session = Depends(get_app_session), current_user = Depends(get_current_active_user)):
    """
    Ensure the order exists in the app DB (import from OES if missing).
    Idempotent: re-calling for the same order_no won't duplicate lines.
    """
    try:
        existed = db.query(OrderModel).filter(OrderModel.order_no == payload.order_no).one_or_none() is not None
        order = ensure_order_in_app(db, payload.order_no)
    except ValueError as e:
        # Raised by service when OES doesn't have the order
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    # Compute totals fresh
    lines: List[OrderLineModel] = db.query(OrderLineModel).filter(OrderLineModel.order_id == order.id).all()
    total_lines = len(lines)
    total_qty = sum(int(getattr(ln, "qty_ordered", 0) or 0) for ln in lines)

    # Mirror totals back if columns exist
    if hasattr(order, "total_lines"):
        order.total_lines = int(total_lines)
    if hasattr(order, "total_qty"):
        order.total_qty = int(total_qty)
    db.commit()
    db.refresh(order)

    return SyncOrderResponse(
        order=order,
        totals=SyncTotals(lines=total_lines, qty=total_qty),
        imported=not existed,
    )


@router.get("/orders/{order_no}", response_model=Order)
def get_order(order_no: str, db: Session = Depends(get_app_session), current_user = Depends(get_current_active_user)):
    order: Optional[OrderModel] = db.query(OrderModel).filter(OrderModel.order_no == order_no).one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Compute totals on the fly if not stored
    if not getattr(order, "total_lines", None) or not getattr(order, "total_qty", None):
        lines = db.query(OrderLineModel).filter(OrderLineModel.order_id == order.id).all()
        order.total_lines = len(lines)
        order.total_qty = sum(int(getattr(ln, "qty_ordered", 0) or 0) for ln in lines)
    return order


@router.get("/orders/{order_no}/lines", response_model=List[OrderLine])
def get_order_lines(order_no: str, db: Session = Depends(get_app_session), current_user = Depends(get_current_active_user)):
    order: Optional[OrderModel] = db.query(OrderModel).filter(OrderModel.order_no == order_no).one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    rows: List[OrderLineModel] = (
        db.query(OrderLineModel)
        .filter(OrderLineModel.order_id == order.id)
        .order_by(OrderLineModel.id.asc())
        .all()
    )

    # Fill line_id mirror for UI
    payload: List[OrderLine] = []
    for ln in rows:
        item = OrderLine.model_validate(ln)  # pydantic from_attributes=True
        item.line_id = int(ln.id)
        payload.append(item)
    return payload
from backend.db import oes_read

@router.get("/orders/oes/{order_no}")
def get_oes_order_preview(order_no: str, current_user = Depends(get_current_active_user)):
    """
    Fetch an order header + lines directly from OES for preview.
    Does NOT persist to the local database.
    """
    try:
        header, lines = oes_read.fetch_order_from_oes(order_no)
        if not header:
            raise HTTPException(status_code=404, detail=f"OES order {order_no} not found")
        return {"header": header, "lines": lines}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OES query failed: {e}")