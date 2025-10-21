from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from backend.services.report import generate_packing_slip_via_excel
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
                    build_note=l.get("Build_note"),
                    product_tag=l.get("product_tag")
                )
            )
        db.commit()

    # 3. Reuse or create pack
    pack = (
        db.query(models.Pack)
        .filter(models.Pack.order_id == order.id)
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
def complete_pack(
    pack_id: int,
    db: Session = Depends(get_db),
):
    """
    Finalize a packing session.
    Ensures all boxes have recorded weights and every order line is fully packed.
    Returns the updated pack snapshot or an error message if validation fails.
    """
    try:
        result = pack_view.complete_pack(db, pack_id)
        # Return the updated snapshot so the UI refreshes immediately
        snapshot = pack_view.get_pack_snapshot(db, pack_id)
        snapshot["message"] = result["message"]
        return snapshot

    except ValueError as e:
        # ✅ Clean JSON error for frontend display
        raise HTTPException(
            status_code=400,
            detail={"error": str(e)}
        )

    except Exception as e:
        # Generic fallback for unexpected errors
        raise HTTPException(
            status_code=500,
            detail={"error": f"Unexpected server error: {str(e)}"}
        )

# ---------------------------------------------------------------------
# Assign item to box
# ---------------------------------------------------------------------
import os
from fastapi.responses import FileResponse
from backend.services.report import generate_packing_slip_via_excel
from backend.services.pack_view import get_packing_slip_data

@router.post("/{pack_id}/assign-one")
def assign_one(pack_id: int, body: dict, db: Session = Depends(get_db)):
    """
    Add one unit of a specific order line into a given box.
    Enforces remaining qty and pair rule.
    """
    try:
        order_line_id = body.get("order_line_id")
        box_id = body.get("box_id")
        if not order_line_id or not box_id:
            raise HTTPException(400, "Missing order_line_id or box_id")
        pack_view.assign_one(db, pack_id, order_line_id, box_id)
        return {"message": "1 unit assigned"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{pack_id}/set-qty")
def set_qty(pack_id: int, body: dict, db: Session = Depends(get_db)):
    """
    Explicitly set the quantity of an order line inside a box.
    """
    try:
        order_line_id = body.get("order_line_id")
        box_id = body.get("box_id")
        qty = body.get("qty")
        if not order_line_id or not box_id or qty is None:
            raise HTTPException(400, "Missing required fields")
        pack_view.set_qty(db, pack_id, box_id, order_line_id, int(qty))
        return {"message": f"Quantity set to {qty}"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{pack_id}/boxes/{box_id}/weight")
def set_box_weight(
    pack_id: int,
    box_id: int,
    body: dict,
    db: Session = Depends(get_db),
):
    """
    Set (or clear) the weight of a specific box.
    Body can be {"weight": float} or {"weight": null}
    Returns the updated pack snapshot.
    """
    weight = body.get("weight")
    try:
        pack_view.set_box_weight(db, pack_id, box_id, weight)
        # Return the updated snapshot so the UI refreshes
        return pack_view.get_pack_snapshot(db, pack_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
@router.delete("/{pack_id}/boxes/{box_id}")
def delete_box(pack_id: int, box_id: int, db: Session = Depends(get_db)):
    """
    Delete a box from a pack.
    Only allowed if the box is empty.
    """
    try:
        pack_view.delete_box_if_empty(db, pack_id, box_id)
        return pack_view.get_pack_snapshot(db, pack_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{pack_id}/boxes/{box_id}/remove-item")
def remove_item_from_box(
    pack_id: int,
    box_id: int,
    body: dict,
    db: Session = Depends(get_db),
):
    """
    Remove a quantity (or the entire item) from a specific box.
    """
    try:
        order_line_id = body.get("order_line_id")
        qty = body.get("qty", 1)
        if not order_line_id:
            raise HTTPException(400, "Missing order_line_id")

        pack_view.remove_item_from_box(db, pack_id, box_id, order_line_id, qty)
        return pack_view.get_pack_snapshot(db, pack_id)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{pack_id}/boxes/{box_id}/duplicate")
def duplicate_box(
    pack_id: int,
    box_id: int,
    db: Session = Depends(get_db),
):
    """
    Duplicate a box with all its items and settings.
    Returns the updated pack snapshot or validation errors.
    """
    try:
        result = pack_view.duplicate_box(db, pack_id, box_id)
        return result
    except pack_view.DuplicateBoxError as e:
        # Return validation errors with product codes that prevent duplication
        raise HTTPException(
            status_code=400,
            detail={"error": str(e), "preventing_products": e.preventing_products}
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail={"error": str(e)}
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": f"Unexpected server error: {str(e)}"}
        )

# ---------------------------------------------------------------------
# Packing Slip PDF and report data endpoints
# ---------------------------------------------------------------------

@router.get("/{pack_id}/packing-slip.pdf")
def export_packing_slip_pdf(pack_id: int):
    """
    Generate a packing slip PDF for the specified pack.

    This endpoint fetches the packing slip data using `get_packing_slip_data`,
    builds a PDF via the Excel-based report generator, and streams the file
    back to the client.  If the pack does not exist, a 404 error is
    returned; if the report fails to generate, a 500 error is raised.
    """
    # Fetch the report data
    data = get_packing_slip_data(pack_id)
    if not data:
        raise HTTPException(404, "Pack not found")

    # Create the PDF via Excel macro
    pdf_path = generate_packing_slip_via_excel(data, pack_id)
    # Validate that the file exists
    if not (pdf_path and os.path.exists(pdf_path)):
        raise HTTPException(500, "PDF generation failed")

    # Stream the file back to the caller
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"packing_slip_{pack_id}.pdf",
    )


@router.get("/{pack_id}/report-data")
def get_packing_slip_report_data(pack_id: int):
    """
    Return the JSON data used to build a packing slip.

    This is useful for debugging or to display the report contents on the
    frontend without generating a PDF.  If the pack is not found, a 404
    error is returned.
    """
    data = get_packing_slip_data(pack_id)
    if not data:
        raise HTTPException(404, "Pack not found")
    return data