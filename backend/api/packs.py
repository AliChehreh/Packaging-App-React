from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from backend.services.report import generate_packing_slip_via_excel
from backend.services.report_html import generate_packing_slip_pdf
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
                    length_in=round(float(l["length_in"] or 0), 3),
                    height_in=round(float(l["height_in"] or 0), 3),
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


@router.get("/{pack_id}/html-packing-slip.pdf")
def export_html_packing_slip_pdf(pack_id: int, db: Session = Depends(get_db)):
    """
    Generate a packing slip PDF using HTML template and Playwright.
    
    Process:
    1. Fetch packing data from database (OES + app DB)
    2. Group identical items for display
    3. Render HTML template with Jinja2
    4. Convert HTML to PDF using Playwright (with full image support)
    5. Return PDF file for download
    
    Returns:
        FileResponse: PDF file download
    """
    try:
        # Fetch packing slip data
        data = get_packing_slip_data(pack_id)
        if not data:
            raise HTTPException(404, f"Pack {pack_id} not found")
        
        # Generate PDF from HTML template using Playwright
        pdf_path = generate_packing_slip_pdf(data, pack_id)
        
        # Verify PDF was created
        if not pdf_path or not os.path.exists(pdf_path):
            raise HTTPException(500, "PDF generation failed - file not created")
        
        # Return PDF file
        return FileResponse(
            path=pdf_path,
            media_type="application/pdf",
            filename=f"packing_slip_{pack_id}.pdf",
            headers={
                "Content-Disposition": f"attachment; filename=packing_slip_{pack_id}.pdf"
            }
        )
    
    except ValueError as e:
        # Database/validation errors
        raise HTTPException(status_code=404, detail=str(e))
    
    except FileNotFoundError as e:
        # Template file missing
        raise HTTPException(
            status_code=500, 
            detail=f"Template not found: {str(e)}"
        )
    
    except Exception as e:
        # Unexpected errors
        import traceback
        error_detail = f"PDF generation error: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)  # Log to console for debugging
        raise HTTPException(
            status_code=500,
            detail=f"PDF generation error: {str(e)}"
        )






@router.get("/{pack_id}/html-preview")
def preview_html_packing_slip(pack_id: int, db: Session = Depends(get_db)):
    """
    Preview the HTML packing slip before PDF conversion.
    
    This endpoint renders the HTML template with all assets embedded as base64,
    allowing you to see exactly how the packing slip will look before generating the PDF.
    
    Returns:
        HTMLResponse: Rendered HTML packing slip
    """
    from fastapi.responses import HTMLResponse
    from jinja2 import Environment, FileSystemLoader, select_autoescape
    import os
    
    def format_phone(value):
        """
        Format phone numbers to standard (xxx) xxx-xxxx format.
        Removes all non-digit characters and formats accordingly.
        Examples: 
        - "6044204323" -> "(604) 420-4323"
        - "(604) 420-4323" -> "(604) 420-4323"
        - "604-420-4323" -> "(604) 420-4323"
        """
        if not value:
            return ''
        
        # Remove all non-digit characters
        digits = ''.join(filter(str.isdigit, str(value)))
        
        # If we have 10 digits, format as (xxx) xxx-xxxx
        if len(digits) == 10:
            return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        
        # If we have 11 digits starting with 1, format as (xxx) xxx-xxxx
        elif len(digits) == 11 and digits[0] == '1':
            return f"({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
        
        # For other lengths, return as-is (might be international format)
        return str(value)
    
    def format_dimension(value):
        """
        Format dimension values:
        - Remove trailing zeros after decimal point
        - Remove decimal point if value is whole number
        Examples: 24.500 -> 24.5, 24.000 -> 24, 24.125 -> 24.125
        """
        if value is None:
            return ''
        try:
            num = float(value)
            # Format to 3 decimal places, then remove trailing zeros
            formatted = f"{num:.3f}".rstrip('0').rstrip('.')
            return formatted
        except (ValueError, TypeError):
            return str(value)
    
    try:
        # Fetch packing slip data
        data = get_packing_slip_data(pack_id)
        if not data:
            raise HTTPException(404, f"Pack {pack_id} not found")
        
        # Setup Jinja2 environment
        templates_dir = os.path.join(
            os.path.dirname(__file__), 
            "..", 
            "templates"
        )
        
        env = Environment(
            loader=FileSystemLoader(templates_dir),
            autoescape=select_autoescape(['html', 'xml'])
        )
        
        # Add custom filters
        env.filters['format_phone'] = format_phone
        env.filters['format_dim'] = format_dimension
        
        # Load template
        template = env.get_template('packing_slip.html')
        
        # Group items for display (same logic as PDF generation)
        from backend.services.report_html import group_items_for_display, load_assets_as_base64
        
        grouped_items = group_items_for_display(data.get('items', []))
        
        # Load assets as base64
        assets = load_assets_as_base64()
        
        # Calculate total pages
        total_pages = 1
        current_page = 1
        
        # Prepare template data
        template_data = {
            **data,  # Include all original data
            'grouped_items': grouped_items,
            'current_page': current_page,
            'total_pages': total_pages,
            'assets': assets,  # Include base64 assets
        }
        
        # Render HTML
        html_content = template.render(**template_data)
        
        # Add auto-print JavaScript to open print dialog and close window after printing
        # Note: Due to browser security restrictions, we cannot programmatically select
        # a specific printer in the print dialog. The browser will use the system default
        # or the last printer the user selected.
        auto_print_script = """
        <script>
        window.onload = function() {
            // Print dialog will use system default or last selected printer
            window.print();
            setTimeout(function() {
                window.close();
            }, 1000);
        };
        </script>
        """
        
        # Insert the script before closing </body> tag
        if '</body>' in html_content:
            html_content = html_content.replace('</body>', auto_print_script + '</body>')
        else:
            html_content += auto_print_script
        
        # Return HTML response
        return HTMLResponse(
            content=html_content,
            status_code=200,
            headers={
                "Content-Type": "text/html; charset=utf-8"
            }
        )
    
    except ValueError as e:
        # Database/validation errors
        raise HTTPException(status_code=404, detail=str(e))
    
    except Exception as e:
        # Other errors (template rendering, asset loading, etc.)
        raise HTTPException(status_code=500, detail=f"HTML preview failed: {str(e)}")


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


# --- Box Label Preview Endpoint ---
@router.get("/system/printers")
def get_system_printers():
    """
    Get list of available printers on the system.
    
    Returns:
        list: List of printer dictionaries with name and id
    """
    from backend.services.printer_service import get_system_printers
    
    try:
        printers = get_system_printers()
        return printers
    except Exception as e:
        import traceback
        error_detail = f"Failed to get printers: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Failed to get printers: {str(e)}")


@router.post("/test-print/{printer_name}")
def test_print(printer_name: str):
    """
    Test printing to a specific printer with simple text.
    
    Args:
        printer_name: Name of the printer to test
        
    Returns:
        dict: Success status and debug information
    """
    from backend.services.printer_service import print_box_label_from_template
    
    try:
        # Create test template data
        test_data = {
            'ship_name': 'John Doe',
            'ship_address1': '123 Main Street',
            'ship_address2': '',
            'ship_city': 'City',
            'ship_province': 'State',
            'ship_postal_code': '12345',
            'ship_country': 'Country',
            'ship_attention': 'John Doe',
            'ship_phone': '(555) 123-4567',
            'order_no': 'TEST-001',
            'project_name': 'Test Project',
            'tag': 'TAG-001',
            'po_number': 'PO-001',
            'items': [
                {'qty': '1', 'desc': 'Test Item', 'length': '10.5', 'height': '8.0'}
            ]
        }
        
        # Try to print using the template approach
        success = print_box_label_from_template(test_data, printer_name)
        
        return {
            "success": success,
            "printer_name": printer_name,
            "message": "Test print completed" if success else "Test print failed"
        }
        
    except Exception as e:
        import traceback
        error_detail = f"Test print failed: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Test print failed: {str(e)}")


@router.post("/{pack_id}/boxes/{box_id}/print-label")
def print_box_label(pack_id: int, box_id: int, printer_name: str = "Default Printer", db: Session = Depends(get_db)):
    """
    Print a single box label directly to the specified printer.
    
    Args:
        pack_id: Pack ID
        box_id: Box ID to print
        printer_name: Name of the printer to print to
        
    Returns:
        dict: Success message
    """
    from backend.services.pack_view import get_box_label_data
    from backend.services.printer_service import print_box_label_from_template, get_system_printers
    
    try:
        # Fetch box label data
        data = get_box_label_data(pack_id, box_id)
        if not data:
            raise HTTPException(404, f"Box {box_id} not found in Pack {pack_id}")
        
        # Validate printer name
        printers = get_system_printers()
        available_printers = [p["name"] for p in printers]
        
        if printer_name not in available_printers:
            # Use first available printer if specified printer not found
            printer_name = available_printers[0] if available_printers else "Default Printer"
        
        # Print the label
        success = print_box_label_from_template(data, printer_name)
        
        if success:
            return {
                "success": True,
                "message": f"Box label for Box {box_id} sent to {printer_name} successfully",
                "box_id": box_id,
                "pack_id": pack_id,
                "printer": printer_name
            }
        else:
            raise HTTPException(500, f"Failed to print box label to {printer_name}")
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        import traceback
        error_detail = f"Box label printing failed: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Box label printing failed: {str(e)}")


@router.post("/{pack_id}/boxes/print-all-labels")
def print_all_box_labels(pack_id: int, printer_name: str = "Default Printer", db: Session = Depends(get_db)):
    """
    Print all box labels for a pack directly to the specified printer.
    
    Args:
        pack_id: Pack ID
        printer_name: Name of the printer to print to
        
    Returns:
        dict: Success message with count of printed labels
    """
    from backend.services.pack_view import get_pack_snapshot
    from backend.services.printer_service import print_box_label_from_template, get_system_printers
    
    try:
        # Get pack snapshot to find all boxes
        pack_snapshot = get_pack_snapshot(db, pack_id)
        if not pack_snapshot:
            raise HTTPException(404, f"Pack {pack_id} not found")
        
        # Filter boxes that have items
        boxes_with_items = [box for box in pack_snapshot.get('boxes', []) if box.get('items')]
        
        if not boxes_with_items:
            raise HTTPException(400, "No boxes with items found to print")
        
        # Validate printer name
        printers = get_system_printers()
        available_printers = [p["name"] for p in printers]
        
        if printer_name not in available_printers:
            # Use first available printer if specified printer not found
            printer_name = available_printers[0] if available_printers else "Default Printer"
        
        # Collect all box label data
        from backend.services.pack_view import get_box_label_data
        from backend.services.printer_service import generate_multi_page_label_html, print_html_to_printer
        
        all_box_data = []
        for box in boxes_with_items:
            try:
                box_data = get_box_label_data(pack_id, box['id'])
                if box_data:
                    all_box_data.append(box_data)
            except Exception as e:
                print(f"Failed to get data for box {box['id']}: {e}")
                continue
        
        if not all_box_data:
            raise HTTPException(400, "No box label data found to print")
        
        # Generate multi-page HTML document with all labels
        multi_page_html = generate_multi_page_label_html(all_box_data)
        
        # Print all labels in one job
        success = print_html_to_printer(multi_page_html, printer_name)
        
        if success:
            printed_count = len(all_box_data)
            failed_count = 0
        else:
            printed_count = 0
            failed_count = len(all_box_data)
            print(f"Failed to print all box labels")
        
        if printed_count > 0:
            message = f"Successfully sent {printed_count} box labels to {printer_name}"
            if failed_count > 0:
                message += f" ({failed_count} failed)"
            
            return {
                "success": True,
                "message": message,
                "printed_count": printed_count,
                "failed_count": failed_count,
                "pack_id": pack_id,
                "printer": printer_name
            }
        else:
            raise HTTPException(500, f"Failed to print any box labels to {printer_name}")
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = f"Print all labels failed: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Print all labels failed: {str(e)}")


@router.get("/{pack_id}/boxes/{box_id}/label-html")
def preview_box_label_html(pack_id: int, box_id: int, db: Session = Depends(get_db)):
    """
    Preview the HTML box label before printing.
    
    This endpoint renders the box_label.html template with all data embedded,
    allowing you to see exactly how the label will look before printing.
    
    Returns:
        HTMLResponse: Rendered HTML box label (4×6 format)
    """
    from fastapi.responses import HTMLResponse
    from jinja2 import Environment, FileSystemLoader, select_autoescape
    from backend.services.pack_view import get_box_label_data
    
    def format_dimension(value):
        """
        Format dimension values:
        - Remove trailing zeros after decimal point
        - Remove decimal point if value is whole number
        Examples: 24.500 -> 24.5, 24.000 -> 24, 24.125 -> 24.125
        """
        if value is None:
            return ''
        try:
            num = float(value)
            # Format to 3 decimal places, then remove trailing zeros
            formatted = f"{num:.3f}".rstrip('0').rstrip('.')
            return formatted
        except (ValueError, TypeError):
            return str(value)
    
    def format_phone(value):
        """
        Format phone numbers to standard (xxx) xxx-xxxx format.
        Removes all non-digit characters and formats accordingly.
        Examples: 
        - "6044204323" -> "(604) 420-4323"
        - "(604) 420-4323" -> "(604) 420-4323"
        - "604-420-4323" -> "(604) 420-4323"
        """
        if not value:
            return ''
        
        # Remove all non-digit characters
        digits = ''.join(filter(str.isdigit, str(value)))
        
        # If we have 10 digits, format as (xxx) xxx-xxxx
        if len(digits) == 10:
            return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        
        # If we have 11 digits starting with 1, format as (xxx) xxx-xxxx
        elif len(digits) == 11 and digits[0] == '1':
            return f"({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
        
        # For other lengths, return as-is (might be international format)
        return str(value)
    
    try:
        # Fetch box label data
        data = get_box_label_data(pack_id, box_id)
        if not data:
            raise HTTPException(404, f"Box {box_id} not found in Pack {pack_id}")
        
        # Setup Jinja2 environment
        templates_dir = os.path.join(
            os.path.dirname(__file__), 
            "..", 
            "templates"
        )
        
        env = Environment(
            loader=FileSystemLoader(templates_dir),
            autoescape=select_autoescape(['html', 'xml'])
        )
        
        # Add custom filter for dimension formatting
        env.filters['format_dim'] = format_dimension
        
        # Add custom filter for phone formatting
        env.filters['format_phone'] = format_phone
        
        # Load template
        template = env.get_template('box_label.html')
        
        # Render HTML with all data
        html_content = template.render(**data)
        
        # Return HTML response
        return HTMLResponse(
            content=html_content,
            status_code=200,
            headers={
                "Content-Type": "text/html; charset=utf-8"
            }
        )
    
    except ValueError as e:
        # Database/validation errors
        raise HTTPException(status_code=404, detail=str(e))
    
    except Exception as e:
        # Other errors (template rendering, etc.)
        import traceback
        error_detail = f"Box label preview failed: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Box label preview failed: {str(e)}")