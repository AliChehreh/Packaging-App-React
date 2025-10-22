# libs/db/oes_read.py

from __future__ import annotations
from typing import Tuple, Dict, List, Optional, Any
from datetime import date, datetime

from sqlalchemy import text
from sqlalchemy.engine import Row
from backend.db.session import oes_engine


# -------------------------
# Header: normalized fields
# -------------------------
HEADER_SQL = text("""
    SELECT
        -- Order basics
        CAST(so.[SalesOrderID] AS NVARCHAR(50))       AS order_no,
        sot.[Name]                   AS lead_time_plan,
        so.[CustomerPONo]                              AS po_number,
        so.[OrderDate]                                 AS order_date,
        so.[DueDate]                                   AS due_date,
        so.[selectedShippingMethod]                    AS selected_shipping_method,

        -- Customer / Bill-To (left column)
        so.[ClientName]                                AS customer_name,
        so.[ClientAddress]                             AS customer_address1,
        so.[ClientAddress2]                            AS customer_address2,
        so.[ClientCity]                                AS customer_city,
        so.[ClientProvince]                            AS customer_province,
        so.[ClientPostalCode]                          AS customer_postal_code,

        -- Ship-To (right column)
        so.[ShippingName]                              AS ship_name,
        so.[ShippingAddress]                           AS ship_address1,
        so.[ShippingAddress2]                          AS ship_address2,
        so.[ShippingCity]                              AS ship_city,
        so.[ShippingProvince]                          AS ship_province,
        so.[ShippingPostalCode]                        AS ship_postal_code,
        so.[ShippingCountry]                           AS ship_country,
        so.[ShippingPhone]                             AS ship_phone,

        -- "Ship By" instruction & date (optional in card)
        so.[ShipBy]                                    AS ship_by,
        so.[DateToBeShipped]                           AS ship_by_date,

        -- Extras kept for future use / PDFs
        so.[OrderStatus],
        so.[ContactName],
        so.[ContactEmail],
        so.[ShippingType],
        so.[Tag],
        so.[ShippingAttention],
        so.[ShipByID],
        so.[ExtraShippingComments],
        so.[ActualShipDate],
        so.[HTClassificationID],
        so.[PackagingNotes],
        so.[ServiceLevel],
        so.[ShippingAccountNo],
        so.[ShippingDefaultTerm],
        so.[ShippingNotes],
        so.[Project],
        so.[IsResidential],
        so.[SalesContactID],
        so.[CustomerNotes],
        so.[WorkOrderNotes],
        so.[SpecificWorkOrderNotes],
        so.[Status]
    FROM [Dayus_OES].[dbo].[SalesOrders] so
    LEFT JOIN [Dayus_OES].[dbo].[SalesOrderTypes] sot
        ON so.SalesOrderTypeID = sot.SalesOrderTypeID
    WHERE CAST(so.[SalesOrderID] AS NVARCHAR(50)) = :order_no
""")


# --------------------------------
# Lines: keep fields used by UI
# --------------------------------
LINES_SQL = text("""
    SELECT
        CAST(sod.[SalesOrderID] AS NVARCHAR(50))   AS order_no,
        sod.[Quantity]                              AS qty_ordered,
        sod.[DisplayName]                           AS product_code,
        sod.[Width]                                 AS length_in,
        sod.[Height]                                AS height_in,
        fn.[DisplayName]                            AS finish,
        sod.[buildNotes]                            AS build_note,
        sod.[productTag]                            AS product_tag
    FROM [Dayus_OES].[dbo].[SalesOrderDetails] sod
    LEFT JOIN [Dayus_OES].[dbo].[Finishes] fn
        ON sod.[ColorID] = fn.[FinishID]
    WHERE sod.[DisplayName] not like '..%' and CAST(sod.[SalesOrderID] AS NVARCHAR(50)) = :order_no
    ORDER BY sod.[DetailID]
""")


def _fmt_date(d: Any) -> Optional[str]:
    """Return YYYY-MM-DD or None; accepts date/datetime/str/None."""
    if d is None:
        return None
    if isinstance(d, (date, datetime)):
        return d.strftime('%Y-%m-%d')
    s = str(d).strip()
    if not s:
        return None
    # Try common SQL Server formats; fall back to raw
    for fmt in ('%Y-%m-%d', '%Y-%m-%d %H:%M:%S', '%m/%d/%Y', '%Y-%m-%d %H:%M:%S.%f'):
        try:
            return datetime.strptime(s, fmt).strftime('%Y-%m-%d')
        except Exception:
            pass
    return s  # last resort: return as-is


def _compose_ship_to(h: Dict[str, Any]) -> str:
    """Optional: a single-line Ship To string for places that want it."""
    bits = [
        h.get('ship_name')]
    return ' | '.join(filter(None, (b.strip() for b in bits if b)))


def _normalize_header(row_map: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize/format header; enforce expected keys for the card."""
    h = dict(row_map)  # shallow copy

    # Dates to YYYY-MM-DD
    h['order_date'] = _fmt_date(h.get('order_date'))
    h['due_date'] = _fmt_date(h.get('due_date'))
    h['ship_by_date'] = _fmt_date(h.get('ship_by_date'))

    # Provide a composed ship_to (optional downstream consumers)
    h['ship_to'] = _compose_ship_to(h)

    # Ensure presence of keys used by the card (fallback to None if missing)
    for k in [
        'order_no', 'order_type_name', 'po_number', 'lead_time_plan',
        'customer_name', 'customer_address1', 'customer_address2',
        'customer_city', 'customer_province', 'customer_postal_code',
        'ship_name', 'ship_address1', 'ship_address2',
        'ship_city', 'ship_province', 'ship_postal_code',
        'ship_country', 'ship_phone', 'ship_by',
    ]:
        h.setdefault(k, None)

    return h


def _normalize_line(m: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce types for UI consumption."""
    out = dict(m)
    # ints where sensible
    try:
        out['qty_ordered'] = int(out.get('qty_ordered') or 0)
    except Exception:
        pass
    # floats for dimensions
    for key in ('length_in', 'height_in'):
        try:
            v = out.get(key)
            out[key] = float(v) if v is not None and str(v).strip() != '' else None
        except Exception:
            pass
    return out


def fetch_order_from_oes(order_no: str) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Fetch order header and lines from OES; returns (header, lines).
    - header: normalized keys for the Order Info card
    - lines: rows with qty_ordered, product_code, length_in, height_in, finish
    """
    with oes_engine.begin() as conn:
        hdr_row: Row | None = conn.execute(HEADER_SQL, {"order_no": order_no}).fetchone()
        if not hdr_row:
            return None, []

        header = _normalize_header(dict(hdr_row._mapping))

        rows = conn.execute(LINES_SQL, {"order_no": order_no}).fetchall()
        lines = [_normalize_line(dict(r._mapping)) for r in rows]

        return header, lines
