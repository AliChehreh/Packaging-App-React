📦 Dayus Packaging App — Technical Summary (v1, Oct 2025)
1. Purpose

A rules-driven packing management system ensuring that physical boxes correspond exactly to ordered quantities.
It integrates with Dayus OES for source orders, while all packing logic and validation live in the local app database.

2. Architecture Overview
Layer	Technology	Notes
Frontend	React 18 + Vite + Ant Design v5	Responsive operator UI
Backend	FastAPI + SQLAlchemy + Alembic	All business rules server-side
Database	SQL Server (ODBC 17/18)	App DB + read-only OES
Environment	Windows, local venv	
External Source	[Dayus_OES].[dbo] via oes_engine	SalesOrders / SalesOrderDetails / Finishes
3. Domain Model (App DB)
Table	Purpose
order	Imported header (order_no unique)
order_line	Product lines (length_in, height_in, qty_ordered, finish)
pack	Packing sessions (status = in_progress or complete)
pack_box	Physical boxes; optional link to carton_type
pack_box_item	Junction between boxes and order_lines
pair_guard	Tracks first co-occurrence of any two order_lines
carton_type	Master carton dimensions + max weight
product_packaging_profile	Future auto-suggestions
user	Operator / supervisor accounts
4. Units & Rounding
Concept	Unit	Rounding
Length / Height	inches	round → nearest int
Weight	pounds	ceil → int
Quantity	units	int only
5. OES Integration

Function: fetch_order_from_oes(order_no) in backend/db/oes_read.py

Normalization rules:

DisplayName NOT LIKE '..%'

Quantities → int

Dimensions → float → round int

Dates → YYYY-MM-DD

ship_to composed from ShippingName

CAST(SalesOrderID AS NVARCHAR(50)) for joins

6. Business Rules
Rule	Behavior
Completion Integrity	Each order_line must have SUM(qty in boxes) == qty_ordered before completion.
Split Lines	Allowed – same line can appear in multiple boxes.
Box Deletion	Only if empty.
Weight Ceiling	Ceil entered weight; must ≤ carton max_weight_lbs.
Pair Rule	Any pair of order lines may co-occur in only one box per order.
Rounding Consistency	Dims int; weights ceil; qty int.
Rule violations	Raise ValueError → HTTP 400 with JSON message.
7. Backend Endpoints
Method	Path	Purpose
GET	/api/orders/{order_no}	Order from app DB
GET	/api/orders/oes/{order_no}	Preview directly from OES
POST	/api/orders/sync	Import from OES
POST	/api/pack/start	Import if missing + create/reuse pack
GET	/api/pack/{id}	Return pack snapshot
POST	/api/pack/{id}/boxes	Add box (predefined or custom)
POST	/api/pack/{id}/assign-one	Add 1 unit to a box
POST	/api/pack/{id}/set-qty	Set explicit qty for a box
POST	/api/pack/{id}/complete	Validate and mark pack complete
8. Pack Snapshot Response
{
  "header": {"order_no":"265485","customer_name":"ACME","status":"in_progress"},
  "lines": [
    {"id":1,"product_code":"DA123","qty_ordered":10,"packed_qty":4,"remaining":6}
  ],
  "boxes": [
    {
      "id":7,
      "label":"Box #7 (12x10x8 in)",
      "weight_lbs":25,
      "items":[{"id":31,"product_code":"DA123","qty":2}]
    }
  ]
}

9. Pair Rule Implementation

Helpers in pack_view.py:

_box_distinct_line_ids() → list lines in a box.

_box_id_with_pair_elsewhere() → detect duplicate pair in another box.

_enforce_pair_rule_on_add() → raises ValueError if violation; adds PairGuard record otherwise.

10. Assign & Set Quantity Logic
def assign_one(db, pack_id, order_line_id, box_id):
    # Validates pack/line, ensures remaining qty > 0
    _enforce_pair_rule_on_add(...)
    upsert PackBoxItem (+1)

def set_qty(db, pack_id, box_id, order_line_id, qty):
    # Checks total across boxes ≤ qty_ordered
    _enforce_pair_rule_on_add(...)
    upsert PackBoxItem(qty) or delete if qty==0


Both enforce:

No overpacking

Pair rule

Transactional commit

11. Pack Completion Logic
def complete_pack(db, pack_id):
    for each line in order:
        packed_qty = SUM(box_item.qty)
        if packed_qty < ordered: raise underpacked
        if packed_qty > ordered: raise overpacked
    pack.status = "complete"
    db.commit()


✅ Handles coalesce/rounding → no false 400 errors.

12. Frontend Architecture (Vite + React + Ant Design)
src/
 ├── api/
 │    ├── orders.js
 │    ├── packs.js
 │    └── cartons.js
 ├── pages/
 │    ├── Orders.jsx   ← unified Scan→Preview→Pack
 │    ├── Packs.jsx
 │    └── Cartons.jsx
 ├── App.jsx           ← sidebar + router shell
 └── main.jsx          ← root mount + antd reset

13. Frontend Workflow
Mode	Trigger	Action
Scan	User scans/enters order #	GET /orders/oes/{no} → Preview
Preview	Click Start Pack	POST /pack/start → GET /pack/{id} → Pack
Pack	Add boxes / Assign items / Complete pack	Live API calls to update state
Complete	All items packed	POST /pack/{id}/complete → status = complete
14. Pack Mode Features (UI)

Box Selection: click to highlight active box.

Assign Items: prompt for qty → calls setQty() API.

Add Box Modal: toggle between custom (L×W×H) and predefined carton type.

Complete Pack: runs final integrity check.

Auto-refresh: calls getPackSnapshot() after every action.

15. Operator Flow

Scan order → preview lines.

Start pack → workspace opens.

Add boxes (custom or predefined).

Click a box → Assign quantities.

Complete pack → validates and locks status.

Return to Scan mode for next order.

16. Validation Summary
Rule	Validated in Backend	Behavior
Underpack/Overpack	complete_pack()	400 error with product code
Pair Rule	_enforce_pair_rule_on_add()	400 error naming offending pair
Box Delete	delete_box_if_empty()	Allowed only if empty
Weight Limit	set_box_weight_lbs()	≤ carton max weight
17. Current Status (Checkpoint)

✔ Backend complete through assign / pair rule / completion.
✔ Frontend fully functional Scan → Preview → Pack workflow.
✔ All rules enforced server-side.
⚙ Next (optional): Step 8 – Box Weight Input or Step 9 – Supervisor Summary UI.

Document updated after successful implementation of Step 7 (Dayus Packaging App, Oct 2025).