import os
import tempfile
import xlwings as xw


def generate_packing_slip_via_excel(data: dict, pack_id: int) -> str:
    """
    Populate header + line data in Excel (cell-based write) and run Build_PackingSlip macro.
    """

    temp_dir = tempfile.gettempdir()
    pdf_path = os.path.join(temp_dir, f"packing_slip_{pack_id}.pdf")

    app = None
    wb = None
    try:
        # ------------------------------------------------------------------
        # Open Excel
        # ------------------------------------------------------------------
        app = xw.App(visible=False, add_book=False)  # visible=True for debugging
        app.display_alerts = False
        app.screen_updating = False

        template_path = os.path.join(
            os.path.dirname(__file__), "..", "Templates", "PackingSlipTemplate.xlsm"
        )
        wb = app.books.open(template_path, read_only=True)
        ws = wb.sheets["PackingSlip"]
        ws.activate()

        # ------------------------------------------------------------------
        # HEADER TABLE (start cell A3)
        # ------------------------------------------------------------------
        #ws.range("A3:AD3").clear_contents()
        header_start = ws.range("A3")
        header_values = [
            data.get("order_no", ""),                    # 1
            data.get("po_number", ""),                   # 2
            data.get("order_date", ""),                  # 3
            data.get("due_date", ""),                    # 4
            data.get("lead_time_plan", ""),              # 5
            data.get("project_name", ""),                # 6
            data.get("tag", ""),                         # 7
            data.get("customer_name", ""),               # 8
            data.get("customer_address1", ""),           # 9
            data.get("customer_address2", ""),           # 10
            data.get("customer_city", ""),               # 11
            data.get("customer_province", ""),           # 12
            data.get("customer_postal_code", ""),        # 13
            data.get("customer_country", ""),            # 14
            data.get("customer_phone", ""),              # 15
            data.get("sales_rep_name", ""),              # 16
            data.get("ship_name", ""),                   # 17
            data.get("ship_address1", ""),               # 18
            data.get("ship_address2", ""),               # 19
            data.get("ship_city", ""),                   # 20
            data.get("ship_province", ""),               # 21
            data.get("ship_postal_code", ""),            # 22
            data.get("ship_country", ""),                # 23
            data.get("ship_attention", ""),              # 24
            data.get("ship_phone", ""),                  # 25
            data.get("ship_email", ""),                  # 26
            data.get("ship_by", ""),                     # 27
            data.get("ship_by_date", ""),                # 28
        ]
        # write vertically down starting at A3
        header_start.value = header_values

        # ------------------------------------------------------------------
        # LINE TABLE (start cell A7)
        # ------------------------------------------------------------------
       # ws.range("A7:K1000").clear_contents()
        line_start = ws.range("A7")

        line_rows = []
        for item in data.get("items", []):
            line_rows.append([
                item.get("box_no", ""),
                item.get("carton_type", ""),
                item.get("weight_lb", ""),
                item.get("qty_ordered", ""),
                item.get("qty_shipped", ""),
                item.get("product_code", ""),
                item.get("length_in", ""),
                item.get("height_in", ""),
                item.get("finish", ""),
                item.get("build_note", ""),
                item.get("product_tag", ""),
            ])

        if line_rows:
            line_start.value = line_rows

        # ------------------------------------------------------------------
        # PDF path + macro call (unchanged)
        # ------------------------------------------------------------------

        # Run macro
        wb.macro("Build_PackingSlip")()

        try:
            wb.sheets["Packing Slip Form"].range("PdfPath").value = pdf_path
        except Exception:
            pass


        # Read returned path (if macro updates it)
        try:
            returned = wb.sheets["Packing Slip Form"].range("ReturnPath").value
            if isinstance(returned, str) and returned.strip():
                pdf_path = returned.strip()
        except Exception:
            pass

        return pdf_path

    finally:
        # ------------------------------------------------------------------
        # Cleanup
        # ------------------------------------------------------------------
        if wb is not None:
            try:
                wb.close()
            except Exception:
                pass
        if app is not None:
            try:
                app.quit()
            except Exception:
                pass
