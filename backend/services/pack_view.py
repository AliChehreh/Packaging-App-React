from __future__ import annotations
from math import ceil
from typing import Dict, List, Optional

from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.db import models


# ---------------------------------------------------------------------
# Pack snapshot for UI
# ---------------------------------------------------------------------
def get_pack_snapshot(db: Session, pack_id: int) -> Dict:
    pack = db.get(models.Pack, pack_id)
    if not pack:
        raise ValueError(f"Pack {pack_id} not found")

    order = pack.order
    if not order:
        raise ValueError(f"Order missing for Pack {pack_id}")

    # --- Lines: qty packed + remaining ---
    qty_sq = (
        select(
            models.PackBoxItem.order_line_id.label("order_line_id"),
            func.coalesce(func.sum(models.PackBoxItem.qty), 0).label("packed_qty"),
        )
        .join(models.PackBox, models.PackBox.id == models.PackBoxItem.pack_box_id)
        .where(models.PackBox.pack_id == pack_id)
        .group_by(models.PackBoxItem.order_line_id)
        .subquery()
    )

    line_stmt = (
        select(
            models.OrderLine.id,
            models.OrderLine.product_code,
            models.OrderLine.length_in,
            models.OrderLine.height_in,
            models.OrderLine.finish,
            models.OrderLine.qty_ordered,
            func.coalesce(qty_sq.c.packed_qty, 0).label("packed_qty"),
        )
        .outerjoin(qty_sq, qty_sq.c.order_line_id == models.OrderLine.id)
        .where(models.OrderLine.order_id == order.id)
        .order_by(models.OrderLine.product_code)
    )
    lines = []
    for row in db.execute(line_stmt).all():
        m = row._mapping
        ordered = int(m["qty_ordered"] or 0)
        packed = int(m["packed_qty"] or 0)
        lines.append(
            {
                "id": m["id"],
                "product_code": m["product_code"],
                "finish": m["finish"],
                "length_in": m["length_in"],
                "height_in": m["height_in"],
                "qty_ordered": ordered,
                "packed_qty": packed,
                "remaining": max(0, ordered - packed),
            }
        )

    # --- Boxes: with label + items ---
    box_stmt = (
        select(
            models.PackBox.id,
            models.PackBox.box_no,
            models.PackBox.weight_lbs,
            models.PackBox.custom_l_in,
            models.PackBox.custom_w_in,
            models.PackBox.custom_h_in,
            models.PackBox.carton_type_id,
            models.CartonType.length_in.label("ct_length_in"),
            models.CartonType.width_in.label("ct_width_in"),
            models.CartonType.height_in.label("ct_height_in"),
            models.CartonType.name.label("ct_name"),
        )
        .outerjoin(models.CartonType, models.CartonType.id == models.PackBox.carton_type_id)
        .where(models.PackBox.pack_id == pack_id)
        .order_by(func.coalesce(models.PackBox.box_no, 2147483647), models.PackBox.id)
    )
    box_rows = db.execute(box_stmt).all()
    box_ids = [int(r._mapping["id"]) for r in box_rows]

    items_by_box: Dict[int, List[Dict]] = {bid: [] for bid in box_ids}
    if box_ids:
        item_stmt = (
            select(
                models.PackBoxItem.id,
                models.PackBoxItem.pack_box_id,
                models.PackBoxItem.order_line_id,
                models.PackBoxItem.qty,
                models.OrderLine.product_code,
            )
            .join(models.OrderLine, models.OrderLine.id == models.PackBoxItem.order_line_id)
            .where(models.PackBoxItem.pack_box_id.in_(box_ids))
        )
        for r in db.execute(item_stmt).all():
            im = r._mapping
            items_by_box[int(im["pack_box_id"])].append(
                {
                    "id": im["id"],
                    "order_line_id": im["order_line_id"],
                    "product_code": im["product_code"],
                    "qty": int(im["qty"] or 0),
                }
            )

    boxes = []
    for b in box_rows:
        bm = b._mapping
        Lc, Wc, Hc = bm["custom_l_in"], bm["custom_w_in"], bm["custom_h_in"]
        if Lc and Wc and Hc:
            dims = (int(Lc), int(Wc), int(Hc))
        else:
            dims = (
                int(bm["ct_length_in"]) if bm["ct_length_in"] else None,
                int(bm["ct_width_in"]) if bm["ct_width_in"] else None,
                int(bm["ct_height_in"]) if bm["ct_height_in"] else None,
            )

        base = f'Box {bm["box_no"]}' if bm["box_no"] else f'Box #{bm["id"]}'
        if all(dims):
            label = f"{base} ({dims[0]}x{dims[1]}x{dims[2]} in)"
        else:
            label = base

        boxes.append(
            {
                "id": bm["id"],
                "box_no": bm["box_no"],
                "label": label,
                "weight_lbs": bm["weight_lbs"],
                "carton_type_id": bm["carton_type_id"],
                "carton_name": bm["ct_name"],
                "custom_l_in": Lc,
                "custom_w_in": Wc,
                "custom_h_in": Hc,
                "items": items_by_box.get(bm["id"], []),
            }
        )

    header = {
        "pack_id": pack.id,
        "order_no": order.order_no,
        "customer_name": order.customer_name,
        "ship_to": order.ship_to,
        "due_date": str(order.due_date) if order.due_date else None,
        "lead_time_plan": order.lead_time_plan,
        "status": pack.status,
    }

    return {"header": header, "lines": lines, "boxes": boxes}


# ---------------------------------------------------------------------
# Pack completion integrity check
# ---------------------------------------------------------------------
def complete_pack(db: Session, pack_id: int) -> None:
    pack = db.get(models.Pack, pack_id)
    if not pack:
        raise ValueError("Pack not found")

    if pack.status == "complete":
        raise ValueError("Pack already complete")

    order = pack.order
    if not order:
        raise ValueError("Order not found for this pack")

    packed_stmt = (
        select(
            models.PackBoxItem.order_line_id,
            func.coalesce(func.sum(models.PackBoxItem.qty), 0).label("packed_qty"),
        )
        .join(models.PackBox, models.PackBox.id == models.PackBoxItem.pack_box_id)
        .where(models.PackBox.pack_id == pack_id)
        .group_by(models.PackBoxItem.order_line_id)
    )
    packed_map = {int(r.order_line_id): int(r.packed_qty or 0) for r in db.execute(packed_stmt)}

    incomplete: List[str] = []
    for line in db.execute(select(models.OrderLine).where(models.OrderLine.order_id == order.id)).scalars():
        ordered = int(line.qty_ordered or 0)
        packed = packed_map.get(line.id, 0)
        if packed != ordered:
            incomplete.append(f"{line.product_code} ({packed}/{ordered})")

    if incomplete:
        msg = "; ".join(incomplete[:5])
        raise ValueError(f"Pack incomplete: {msg}")

    pack.status = "complete"
    db.commit()
