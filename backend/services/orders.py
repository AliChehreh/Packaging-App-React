# backend/services/orders.py
from typing import Tuple, Dict, List, Optional
from sqlalchemy.orm import Session

from backend.db.models import Order, OrderLine
from backend.db.oes_read import fetch_order_from_oes  # uses OES engine & SQL, normalized fields  :contentReference[oaicite:1]{index=1}


def _to_decimal_round(x):
    """Convert to decimal with 3 decimal places, handling None values."""
    if x is None:
        return 0.0
    try:
        return round(float(x), 3)
    except Exception:
        return 0.0


def ensure_order_in_app(db: Session, order_no: str) -> Order:
    """
    If the order isn't in our app DB, import header + lines from OES and persist.
    If present, just return it. Idempotent by (order_no, line identity).
    """
    order = db.query(Order).filter(Order.order_no == order_no).one_or_none()
    if order:
        return order

    header, lines = fetch_order_from_oes(order_no)
    if header is None:
        raise ValueError(f"Order {order_no} not found in OES")

    order = Order(
        order_no=str(header.get("order_no") or order_no),
        customer_name=header.get("customer_name"),
        due_date=header.get("due_date"),
        lead_time_plan=header.get("lead_time_plan"),
        ship_to=header.get("ship_to"),
        source="OES",
    )
    db.add(order)
    db.flush()  # populate order.id

    for ln in (lines or []):
        db.add(OrderLine(
            order_id=order.id,
            product_code=ln.get("product_code"),
            length_in=_to_decimal_round(ln.get("length_in")),
            height_in=_to_decimal_round(ln.get("height_in")),
            finish=ln.get("finish"),
            qty_ordered=int(ln.get("qty_ordered") or 0),
            build_note=ln.get("build_note"),
            product_tag=ln.get("product_tag"),
        ))

    db.commit()
    db.refresh(order)
    return order
