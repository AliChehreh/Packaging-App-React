from __future__ import annotations
import math

from typing import Dict, List, Optional

from sqlalchemy import select, func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from datetime import datetime
from backend.db import models
from backend.services.barcode_helper import generate_barcode_base64
from backend.db.session import oes_engine, app_engine


class DuplicateBoxError(Exception):
    """Custom exception for box duplication validation errors."""
    def __init__(self, message: str, preventing_products: List[Dict]):
        super().__init__(message)
        self.preventing_products = preventing_products

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
            models.PackBox.weight_entered,  # ✅ NEW FIELD: raw input value
            models.PackBox.custom_l_in,
            models.PackBox.custom_w_in,
            models.PackBox.custom_h_in,
            models.PackBox.carton_type_id,
            models.PackBox.max_weight_lb,  # ✅ NEW: store per-box override (if exists)
            models.CartonType.length_in.label("ct_length_in"),
            models.CartonType.width_in.label("ct_width_in"),
            models.CartonType.height_in.label("ct_height_in"),
            models.CartonType.name.label("ct_name"),
            models.CartonType.max_weight_lb.label("ct_max_weight_lb"),  # ✅ NEW: carton max
        )
        .outerjoin(models.CartonType, models.CartonType.id == models.PackBox.carton_type_id)
        .where(models.PackBox.pack_id == pack_id)
        .order_by(func.coalesce(models.PackBox.box_no, 2147483647), models.PackBox.id)
    )

    box_rows = db.execute(box_stmt).all()
    box_ids = [int(r._mapping["id"]) for r in box_rows]

    # --- Items grouped by box ---
    items_by_box: Dict[int, List[Dict]] = {bid: [] for bid in box_ids}
    if box_ids:
        item_stmt = (
            select(
                models.PackBoxItem.id,
                models.PackBoxItem.pack_box_id,
                models.PackBoxItem.order_line_id,
                models.PackBoxItem.qty,
                models.OrderLine.product_code,
                models.OrderLine.length_in,
                models.OrderLine.height_in,
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
                    "length_in": im["length_in"],
                    "height_in": im["height_in"],
                    "qty": int(im["qty"] or 0),
                }
            )

    # --- Build box list ---
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
                "weight_entered": float(bm["weight_entered"]) if bm["weight_entered"] is not None else None,  # ✅ include decimal
                "carton_type_id": bm["carton_type_id"],
                "carton_name": bm["ct_name"],
                "custom_l_in": Lc,
                "custom_w_in": Wc,
                "custom_h_in": Hc,
                "max_weight_lb": bm["max_weight_lb"] or bm["ct_max_weight_lb"],  # ✅ combined ceiling
                "items": items_by_box.get(bm["id"], []),
            }
        )

    # --- Header ---
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

def complete_pack(db: Session, pack_id: int, completed_by_user_id: int):
    """
    Validate that:
      1. Every box in the pack has a recorded weight.
      2. Every order line is fully packed (no under/overpack).
    Then mark the pack as complete.
    """
    pack = db.get(models.Pack, pack_id)
    if not pack:
        raise ValueError("Pack not found")

    # ✅ 1. Ensure all boxes have recorded weights
    for box in pack.boxes:
        if box.weight_lbs is None:
            box_label = f"Box {box.box_no or box.id}"
            raise ValueError(f"Cannot complete pack: {box_label} has no recorded weight")

    # ✅ 2. Verify all order lines are fully packed
    order_lines = (
        db.query(models.OrderLine)
        .filter(models.OrderLine.order_id == pack.order_id)
        .all()
    )

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
                f"Cannot complete pack: underpacked line {line.product_code} "
                f"({packed_qty}/{ordered_qty})"
            )
        elif packed_qty > ordered_qty:
            raise ValueError(
                f"Cannot complete pack: overpacked line {line.product_code} "
                f"({packed_qty}/{ordered_qty})"
            )

    # ✅ 3. All validations passed → mark complete
    pack.status = "complete"
    pack.completed_by = completed_by_user_id  # Set the user who completed the pack
    pack.completed_at = datetime.utcnow()  # Set the completion timestamp
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

def validate_box_weight(weight_entered: float, max_weight: int | None) -> int:
    if weight_entered is None:
        raise ValueError("Weight must be provided")
    if weight_entered <= 0:
        raise ValueError("Weight must be positive")
    if weight_entered > 500:
        raise ValueError("Weight exceeds plausible limit")
    weight_lbs = math.ceil(weight_entered)
    if max_weight and weight_lbs > max_weight:
        raise ValueError(f"Box overweight ({weight_lbs} lb > limit {max_weight} lb)")
    return weight_lbs

def set_box_weight(db: Session, pack_id: int, box_id: int, weight: float | None) -> None:
    pack = db.get(models.Pack, pack_id)
    if not pack:
        raise ValueError("Pack not found")

    box = db.get(models.PackBox, box_id)
    if not box or box.pack_id != pack_id:
        raise ValueError("Box not found in this pack")

    # Determine max allowed weight
    # Use per-box override first; otherwise fall back to the carton type’s max weight.
    limit = None
    if box.max_weight_lb:
        limit = box.max_weight_lb
    elif box.carton and box.carton.max_weight_lb:
        limit = box.carton.max_weight_lb

    # If weight is None, clear both fields
    if weight is None:
        box.weight_entered = None
        box.weight_lbs = None
    else:
        weight_lbs = validate_box_weight(weight, limit)
        box.weight_entered = weight
        box.weight_lbs = weight_lbs

    db.commit()

# ---------------------------------------------------------------------
# Delete box if empty
# ---------------------------------------------------------------------

def delete_box_if_empty(db: Session, pack_id: int, box_id: int):
    """
    Delete a box only if it belongs to the given pack and contains no items.
    """
    box = (
        db.query(models.PackBox)
        .filter(models.PackBox.id == box_id, models.PackBox.pack_id == pack_id)
        .first()
    )
    if not box:
        raise ValueError(f"Box {box_id} not found for Pack {pack_id}")

    item_count = (
        db.query(func.count(models.PackBoxItem.id))
        .filter(models.PackBoxItem.pack_box_id == box_id)
        .scalar()
    )
    if item_count and item_count > 0:
        raise ValueError(f"Cannot delete Box {box_id}: it is not empty")

    db.delete(box)
    db.flush()
    _renumber_boxes(db, pack_id)
    db.commit()

# ---------------------------------------------------------------------
# Remove Items from Box
# ---------------------------------------------------------------------


def remove_item_from_box(
    db: Session, pack_id: int, box_id: int, order_line_id: int, qty: int = 1
):
    """
    Remove a specific quantity (or all) of an item from a box.
    Enforces that the box belongs to the same pack.
    """
    if qty <= 0:
        raise ValueError("Quantity to remove must be positive")

    # Validate box ownership
    box = (
        db.query(models.PackBox)
        .filter(models.PackBox.id == box_id, models.PackBox.pack_id == pack_id)
        .first()
    )
    if not box:
        raise ValueError(f"Box {box_id} not found for Pack {pack_id}")

    # Find item entry
    item = (
        db.query(models.PackBoxItem)
        .filter(
            models.PackBoxItem.pack_box_id == box_id,
            models.PackBoxItem.order_line_id == order_line_id,
        )
        .first()
    )
    if not item:
        raise ValueError("Item not found in this box")

    if qty >= item.qty:
        # remove entire record
        db.delete(item)
    else:
        # decrement quantity
        item.qty -= qty

    db.commit()


def _next_box_no(db: Session, pack_id: int) -> int:
    """Get the next box number for a pack."""
    q = select(func.coalesce(func.max(models.PackBox.box_no), 0)).where(models.PackBox.pack_id == pack_id)
    return int(db.execute(q).scalar_one()) + 1


def _renumber_boxes(db: Session, pack_id: int) -> None:
    """
    Ensure boxes are numbered sequentially after deletions.
    """
    boxes = (
        db.query(models.PackBox)
        .filter(models.PackBox.pack_id == pack_id)
        .order_by(func.coalesce(models.PackBox.box_no, 2147483647), models.PackBox.id)
        .all()
    )

    changed = False
    for idx, box in enumerate(boxes, start=1):
        if box.box_no != idx:
            box.box_no = idx
            changed = True

    if changed:
        db.flush()


def duplicate_box(db: Session, pack_id: int, box_id: int):
    """
    Duplicate a box with all its items and settings.
    Validates that there's enough remaining quantity for all items.
    Returns the updated pack snapshot.
    """
    # Validate pack and box
    pack = db.get(models.Pack, pack_id)
    if not pack:
        raise ValueError("Pack not found")

    original_box = (
        db.query(models.PackBox)
        .filter(models.PackBox.id == box_id, models.PackBox.pack_id == pack_id)
        .first()
    )
    if not original_box:
        raise ValueError(f"Box {box_id} not found for Pack {pack_id}")

    # Get all items in the original box
    original_items = (
        db.query(models.PackBoxItem)
        .filter(models.PackBoxItem.pack_box_id == box_id)
        .all()
    )

    if not original_items:
        raise ValueError("Cannot duplicate empty box")

    # Check remaining quantities for all items
    preventing_products = []
    for item in original_items:
        # Get total packed quantity for this line across all boxes
        total_packed = (
            db.query(func.coalesce(func.sum(models.PackBoxItem.qty), 0))
            .join(models.PackBox, models.PackBox.id == models.PackBoxItem.pack_box_id)
            .where(
                models.PackBox.pack_id == pack_id,
                models.PackBoxItem.order_line_id == item.order_line_id,
            )
            .scalar()
        )

        # Get ordered quantity
        order_line = db.get(models.OrderLine, item.order_line_id)
        if not order_line:
            continue

        ordered_qty = order_line.qty_ordered
        remaining = ordered_qty - total_packed

        if remaining < item.qty:
            preventing_products.append({
                "product_code": order_line.product_code,
                "needed": item.qty,
                "remaining": remaining
            })

    if preventing_products:
        raise DuplicateBoxError(
            "Cannot duplicate box: insufficient remaining quantities",
            preventing_products
        )

    # Create new box with same settings
    new_box = models.PackBox(
        pack_id=pack_id,
        box_no=_next_box_no(db, pack_id),
        carton_type_id=original_box.carton_type_id,
        custom_l_in=original_box.custom_l_in,
        custom_w_in=original_box.custom_w_in,
        custom_h_in=original_box.custom_h_in,
        max_weight_lb=original_box.max_weight_lb,
        weight_lbs=original_box.weight_lbs,
        weight_entered=original_box.weight_entered,
    )
    db.add(new_box)
    db.flush()  # Get the new box ID

    # Duplicate all items
    for item in original_items:
        new_item = models.PackBoxItem(
            pack_box_id=new_box.id,
            order_line_id=item.order_line_id,
            qty=item.qty
        )
        db.add(new_item)

    db.commit()

    # Return updated snapshot
    return get_pack_snapshot(db, pack_id)


# ---------------------------------------------------------------------
# Data assembler for packing slip report
# ---------------------------------------------------------------------
def get_packing_slip_data(pack_id: int):
    """Fetch packing slip data for a completed pack."""
    # --- 0. Get order_no from local pack + order tables (app DB) ---
    query_pack = text("""
        SELECT ord.order_no
        FROM pack
        LEFT JOIN dbo.[order] AS ord ON pack.order_id = ord.id
        WHERE pack.id = :pack_id
    """)
    with app_engine.connect() as conn:
        order_no = conn.execute(query_pack, {"pack_id": pack_id}).scalar_one_or_none()

    if not order_no:
        raise ValueError(f"Pack {pack_id} not found or missing linked order.")

    # --- 1. Get order and customer info from OES using order_no ---
    query_header = text("""
        SELECT
            CAST(so.SalesOrderID AS NVARCHAR(50)) AS order_no,
            sot.Name AS lead_time_plan,
            so.CustomerPONo AS po_number,
            CONVERT(VARCHAR(10), so.OrderDate, 120) AS order_date,
            CONVERT(VARCHAR(10), so.DueDate, 120) AS due_date,
            so.Project AS project_name,
            so.Tag AS tag,
            so.ClientName AS customer_name,
            so.ClientAddress AS customer_address1,
            so.ClientAddress2 AS customer_address2,
            so.ClientCity AS customer_city,
            so.ClientProvince AS customer_province,
            so.ClientPostalCode AS customer_postal_code,
            so.ClientCountry AS customer_country,
            so.ClientPhone AS customer_phone,
            so.contactName AS sales_rep_name,
            so.ContactEmail AS client_email,
            so.ShippingName AS ship_name,
            so.ShippingAddress AS ship_address1,
            so.ShippingAddress2 AS ship_address2,
            so.ShippingCity AS ship_city,
            so.ShippingProvince AS ship_province,
            so.ShippingPostalCode AS ship_postal_code,
            so.ShippingCountry AS ship_country,
            so.ShippingPhone AS ship_phone,
            so.ShippingAttention AS ship_attention,
            so.ContactEmail AS ship_email,
            CONCAT(so.shipby,' - ',so.ServiceLevel,' - ',so.ShippingDefaultTerm,' - Account #: ',so.ShippingAccountNo) AS ship_by,
            CONVERT(VARCHAR(10), so.ActualShipDate, 120) AS ship_by_date,
            so.OrderStatus,
            so.ShippingNotes
        FROM SalesOrders so
        LEFT JOIN SalesOrderTypes sot ON so.SalesOrderTypeID = sot.SalesOrderTypeID
        WHERE CAST(so.SalesOrderID AS NVARCHAR(50)) = :order_no
    """)
    with oes_engine.connect() as conn:
        order_info = conn.execute(query_header, {"order_no": order_no}).mappings().first()

    if not order_info:
        raise ValueError(f"OES order {order_no} not found.")

    ship_date = order_info.get("ship_by_date") or datetime.now().strftime("%Y-%m-%d")

    # --- 2. Get packing items (from app DB) ---
    query_items_local = text("""
        SELECT
            pb.box_no,
            ISNULL(ct.name,
                CONCAT('Custom ', pb.custom_l_in, 'x', pb.custom_w_in, 'x', pb.custom_h_in)
            ) AS carton_type,
            pb.weight_lbs AS weight_lb,
            ol.product_code,
            ol.length_in,
            ol.height_in,
            ol.finish,
            ol.qty_ordered,
            pbi.qty AS qty_shipped,
            ol.build_note,
            ol.product_tag
        FROM pack_box_item AS pbi
        INNER JOIN pack_box AS pb ON pbi.pack_box_id = pb.id
        INNER JOIN [order_line] AS ol ON pbi.order_line_id = ol.id
        LEFT JOIN carton_type AS ct ON pb.carton_type_id = ct.id
        WHERE pb.pack_id = :pack_id
        ORDER BY pb.box_no, ol.product_code
    """)
    
    with app_engine.connect() as conn:
        items = [dict(row) for row in conn.execute(query_items_local, {"pack_id": pack_id}).mappings()]

    # --- 3. Get box info (from app DB) ---
    query_boxes = text("""
        SELECT 
            pb.box_no,
            ISNULL(ct.name,
                CONCAT('Custom ', pb.custom_l_in, 'x', pb.custom_w_in, 'x', pb.custom_h_in)
            ) AS carton_type,
            pb.weight_lbs
        FROM pack_box AS pb
        LEFT JOIN carton_type AS ct ON pb.carton_type_id = ct.id
        WHERE pb.pack_id = :pack_id
        ORDER BY pb.box_no
    """)
    
    with app_engine.connect() as conn:
        boxes = [dict(row) for row in conn.execute(query_boxes, {"pack_id": pack_id}).mappings()]

    # --- 4. Merge into final data structure ---
    slip = dict(order_info)
    slip["ship_by_date"] = ship_date
    slip["boxes"] = boxes
    slip["items"] = items
    slip["pack_id"] = pack_id
    slip["generated_by"] = "system"  # or current user
    slip["generated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    slip["notes"] = order_info.get("ShippingNotes") or ""

    return slip


# --- 8. Box label data assembler
# ---------------------------------------------------------------------
def get_box_label_data(pack_id: int, box_id: int):
    """
    Fetch all data needed to render a box label for a specific box.
    
    Returns dict with:
    - Order info: order_no, project_name, tag, po_number
    - Shipping info: ship_name, ship_address1, ship_address2, ship_city, 
                     ship_province, ship_postal_code, ship_country, ship_attention
    - Box info: box_no
    - Items: list of {qty, product_code, length_in, height_in} for this box
    """
    # --- 0. Get order_no from local pack + order tables (app DB) ---
    query_pack = text("""
        SELECT ord.order_no
        FROM pack
        LEFT JOIN dbo.[order] AS ord ON pack.order_id = ord.id
        WHERE pack.id = :pack_id
    """)
    with app_engine.connect() as conn:
        order_no = conn.execute(query_pack, {"pack_id": pack_id}).scalar_one_or_none()

    if not order_no:
        raise ValueError(f"Pack {pack_id} not found or missing linked order.")

    # --- 1. Get order and shipping info from OES ---
    query_header = text("""
        SELECT
            CAST(so.SalesOrderID AS NVARCHAR(50)) AS order_no,
            so.Project AS project_name,
            so.Tag AS tag,
            so.CustomerPONo AS po_number,
            so.ShippingName AS ship_name,
            so.ShippingAddress AS ship_address1,
            so.ShippingAddress2 AS ship_address2,
            so.ShippingCity AS ship_city,
            so.ShippingProvince AS ship_province,
            so.ShippingPostalCode AS ship_postal_code,
            so.ShippingCountry AS ship_country,
            so.ShippingAttention AS ship_attention,
            so.ShippingPhone AS ship_phone
        FROM SalesOrders so
        WHERE CAST(so.SalesOrderID AS NVARCHAR(50)) = :order_no
    """)
    with oes_engine.connect() as conn:
        order_info = conn.execute(query_header, {"order_no": order_no}).mappings().first()

    if not order_info:
        raise ValueError(f"OES order {order_no} not found.")

    # --- 2. Get box info from app DB ---
    query_box = text("""
        SELECT 
            pb.box_no
        FROM pack_box AS pb
        WHERE pb.id = :box_id AND pb.pack_id = :pack_id
    """)
    
    with app_engine.connect() as conn:
        box_info = conn.execute(query_box, {"box_id": box_id, "pack_id": pack_id}).mappings().first()

    if not box_info:
        raise ValueError(f"Box {box_id} not found in Pack {pack_id}")

    # --- 3. Get items in this box (from app DB) ---
    query_items = text("""
        SELECT
            pbi.qty,
            ol.product_code,
            ol.length_in,
            ol.height_in
        FROM pack_box_item AS pbi
        INNER JOIN [order_line] AS ol ON pbi.order_line_id = ol.id
        WHERE pbi.pack_box_id = :box_id
        ORDER BY ol.product_code
    """)
    
    with app_engine.connect() as conn:
        items = [dict(row) for row in conn.execute(query_items, {"box_id": box_id}).mappings()]

    # --- 4. Merge into final data structure ---
    label_data = dict(order_info)
    label_data["box_no"] = box_info["box_no"]
    label_data["items"] = items
    label_data["pack_id"] = pack_id
    label_data["box_id"] = box_id

    return label_data