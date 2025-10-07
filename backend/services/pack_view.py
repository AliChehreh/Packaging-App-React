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

def complete_pack(db: Session, pack_id: int):
    """
    Validate all order lines fully packed before marking complete.
    """
    pack = db.get(models.Pack, pack_id)
    if not pack:
        raise ValueError("Pack not found")

    # Retrieve all order lines for this order
    order_lines = (
        db.query(models.OrderLine)
        .filter(models.OrderLine.order_id == pack.order_id)
        .all()
    )

    # Iterate through each line and verify totals
    for line in order_lines:
        stmt = (
            select(func.coalesce(func.sum(models.PackBoxItem.qty), 0))
            .join(models.PackBox, models.PackBox.id == models.PackBoxItem.pack_box_id)
            .where(
                models.PackBox.pack_id == pack_id,
                models.PackBoxItem.order_line_id == line.id,
            )
        )
        packed_qty = int(db.execute(stmt).scalar_one() or 0)
        ordered_qty = int(line.qty_ordered or 0)

        if packed_qty < ordered_qty:
            raise ValueError(
                f"Cannot complete pack: underpacked line {line.product_code} ({packed_qty}/{ordered_qty})"
            )
        elif packed_qty > ordered_qty:
            raise ValueError(
                f"Cannot complete pack: overpacked line {line.product_code} ({packed_qty}/{ordered_qty})"
            )

    # All lines perfectly packed → mark complete
    pack.status = "complete"
    db.commit()
    return {"message": "Pack marked complete"}

# ---------------------------------------------------------------------------
# Pair Rule enforcement helpers
# ---------------------------------------------------------------------------

def _box_distinct_line_ids(db: Session, box_id: int) -> list[int]:
    """Return distinct order_line_ids currently in this box."""
    stmt = (
        select(models.PackBoxItem.order_line_id)
        .where(models.PackBoxItem.pack_box_id == box_id)
        .group_by(models.PackBoxItem.order_line_id)
    )
    return [int(r[0]) for r in db.execute(stmt).all()]


def _box_id_with_pair_elsewhere(db: Session, pack_id: int, exclude_box_id: int,
                                a_line_id: int, b_line_id: int) -> int | None:
    """Return another box_id in this pack (≠ exclude_box_id) that already contains both lines."""
    stmt = (
        select(models.PackBoxItem.pack_box_id)
        .join(models.PackBox, models.PackBox.id == models.PackBoxItem.pack_box_id)
        .where(
            models.PackBox.pack_id == pack_id,
            models.PackBoxItem.order_line_id.in_([a_line_id, b_line_id])
        )
        .group_by(models.PackBoxItem.pack_box_id)
        .having(func.count(func.distinct(models.PackBoxItem.order_line_id)) == 2)
    )
    for row in db.execute(stmt):
        box_id = int(row._mapping.get("pack_box_id", row[0]))
        if box_id != exclude_box_id:
            return box_id
    return None


def _enforce_pair_rule_on_add(db: Session, pack_id: int, dest_box_id: int, new_line_id: int) -> None:
    """
    Enforce the 'pair rule' when adding a new line to a box:
    Any two order lines can co-occur together in at most one box per order.
    """
    present_line_ids = _box_distinct_line_ids(db, dest_box_id)
    if not present_line_ids:
        return

    pack = db.get(models.Pack, pack_id)
    if not pack:
        raise ValueError("Pack not found")
    order_id = int(pack.order_id)

    for existing_line_id in present_line_ids:
        if existing_line_id == new_line_id:
            continue

        # Check if this pair already co-exists elsewhere
        other_box_id = _box_id_with_pair_elsewhere(
            db, pack_id, dest_box_id, existing_line_id, new_line_id
        )
        if other_box_id is not None:
            a_line = db.get(models.OrderLine, existing_line_id)
            b_line = db.get(models.OrderLine, new_line_id)
            a_code = a_line.product_code if a_line else str(existing_line_id)
            b_code = b_line.product_code if b_line else str(new_line_id)
            raise ValueError(
                f"Pair rule: {a_code} + {b_code} already together in Box #{other_box_id}"
            )
        # Record the new pair in pair_guard table (idempotent)
        try:
            a, b = sorted((int(existing_line_id), int(new_line_id)))
            db.add(models.PairGuard(order_id=order_id, line_a_id=a, line_b_id=b))
            db.flush()
        except IntegrityError:
            db.rollback()
            # already recorded; ignore


def assign_one(db: Session, pack_id: int, order_line_id: int, box_id: int) -> None:
    """
    Adds one unit of a line to a box.
    Checks remaining quantity, pair rule, and updates pack snapshot.
    """
    pack = db.get(models.Pack, pack_id)
    if not pack:
        raise ValueError("Pack not found")

    line = db.get(models.OrderLine, order_line_id)
    if not line:
        raise ValueError("Order line not found")

    # --- total packed so far for this line across all boxes ---
    q_stmt = (
        select(func.coalesce(func.sum(models.PackBoxItem.qty), 0))
        .join(models.PackBox, models.PackBox.id == models.PackBoxItem.pack_box_id)
        .where(
            models.PackBox.pack_id == pack_id,
            models.PackBoxItem.order_line_id == order_line_id,
        )
    )
    packed_qty = db.execute(q_stmt).scalar_one()
    if packed_qty >= line.qty_ordered:
        raise ValueError("No remaining quantity to pack")

    # --- enforce pair rule (new line into this box) ---
    _enforce_pair_rule_on_add(db, pack_id, box_id, order_line_id)

    # --- upsert item (increase by 1) ---
    existing = (
        db.query(models.PackBoxItem)
        .filter_by(pack_box_id=box_id, order_line_id=order_line_id)
        .first()
    )
    if existing:
        existing.qty += 1
    else:
        db.add(models.PackBoxItem(pack_box_id=box_id, order_line_id=order_line_id, qty=1))

    db.commit()


def set_qty(db: Session, pack_id: int, box_id: int, order_line_id: int, qty: int) -> None:
    """
    Explicitly sets the quantity of a line in a box.
    Enforces remaining total ≤ ordered, and pair rule.
    """
    if qty < 0:
        raise ValueError("Quantity cannot be negative")

    pack = db.get(models.Pack, pack_id)
    if not pack:
        raise ValueError("Pack not found")

    line = db.get(models.OrderLine, order_line_id)
    if not line:
        raise ValueError("Order line not found")

    # --- total packed in other boxes (excluding current) ---
    total_elsewhere = (
        select(func.coalesce(func.sum(models.PackBoxItem.qty), 0))
        .join(models.PackBox, models.PackBox.id == models.PackBoxItem.pack_box_id)
        .where(
            models.PackBox.pack_id == pack_id,
            models.PackBoxItem.order_line_id == order_line_id,
            models.PackBoxItem.pack_box_id != box_id,
        )
    )
    already_packed_elsewhere = db.execute(total_elsewhere).scalar_one()
    remaining_allowed = int(line.qty_ordered) - int(already_packed_elsewhere)

    if qty > remaining_allowed:
        raise ValueError(
            f"Overpacking not allowed: remaining {remaining_allowed}, tried {qty}"
        )

    # --- enforce pair rule before applying change ---
    _enforce_pair_rule_on_add(db, pack_id, box_id, order_line_id)

    # --- upsert item ---
    existing = (
        db.query(models.PackBoxItem)
        .filter_by(pack_box_id=box_id, order_line_id=order_line_id)
        .first()
    )
    if qty == 0:
        # delete if setting to zero
        if existing:
            db.delete(existing)
    elif existing:
        existing.qty = qty
    else:
        db.add(models.PackBoxItem(pack_box_id=box_id, order_line_id=order_line_id, qty=qty))

    db.commit()