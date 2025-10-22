# Dimension Formatting Implementation

## Overview
This document outlines the comprehensive changes made to support decimal dimensions (up to 3 decimal places) throughout the entire codebase, with proper formatting that shows whole numbers without decimal points when the decimal part is .000.

## Database Changes

### Migration Script
**File:** `backend/migrations/update_dimensions_to_decimal.sql`

This script updates the database schema to change dimension columns from INTEGER to DECIMAL(10,3):

- `order_line.length_in` and `order_line.height_in`
- `product_packaging_profile.depth_in`, `length_mod_in`, `height_mod_in`
- `pack_line_override.depth_in`, `length_mod_in`, `height_mod_in`
- Optional: `carton_type` and `pack_box` custom dimensions (commented out)

### Model Updates
**File:** `backend/db/models.py`

Updated SQLAlchemy models to use `DECIMAL(10, 3)` instead of `Integer`:
- `OrderLine.length_in` and `height_in`
- `CartonType.length_in`, `width_in`, `height_in`
- `ProductPackagingProfile.depth_in`, `length_mod_in`, `height_mod_in`
- `PackBox.custom_l_in`, `custom_w_in`, `custom_h_in`
- `PackLineOverride.depth_in`, `length_mod_in`, `height_mod_in`

## Backend Changes

### Services Updates

#### Orders Service
**File:** `backend/services/orders.py`
- Updated `_to_int_round()` to `_to_decimal_round()` function
- Now rounds to 3 decimal places instead of integers
- Applied to both `length_in` and `height_in` when importing from OES

#### Packs API
**File:** `backend/api/packs.py`
- Updated dimension processing to use `round(float(value), 3)` instead of `round(float(value))`
- Ensures 3 decimal place precision when creating order lines

## Frontend Changes

### Formatting Function
Added a consistent `formatDimension()` helper function to both:
- `Frontend/vite-project/src/pages/Orders.jsx`
- `Frontend/vite-project/src/pages/Cartons.jsx`

**Function behavior:**
- Formats numbers to 3 decimal places maximum
- Removes decimal point when decimal part is .000 (e.g., `12.000` → `12`)
- Handles null/undefined values gracefully
- Validates input to ensure it's a valid number

### Updated Components

#### Orders.jsx
- **Carton Type Display**: In AddBoxModal, carton dimensions show formatted
- **Product Dimensions in Box Items**: Product dimensions display formatted
- **Order Lines Tables**: Both preview and main tables show formatted dimensions
- **Table Columns**: All `length_in` and `height_in` columns use formatting

#### Cartons.jsx
- **Table Columns**: All dimension columns (L, W, H) use formatting
- **Form Inputs**: Maintain decimal support for input

## Examples of Formatting

| Input Value | Formatted Output |
|-------------|------------------|
| `12.000`    | `12`             |
| `12.500`    | `12.500`         |
| `12.123`    | `12.123`         |
| `12.100`    | `12.100`         |
| `null`      | `null`           |
| `undefined` | `undefined`      |

## Implementation Steps

### 1. Database Migration
```sql
-- Run the migration script
-- This changes INTEGER columns to DECIMAL(10,3)
```

### 2. Backend Deployment
- Deploy updated models and services
- Ensure all dimension processing uses 3 decimal places

### 3. Frontend Deployment
- Deploy updated components with formatting functions
- Test dimension display across all interfaces

## Benefits

1. **Precision**: Supports decimal dimensions up to 3 decimal places
2. **User Experience**: Clean display of whole numbers without unnecessary decimal points
3. **Consistency**: Uniform formatting across all components
4. **Backward Compatibility**: Existing integer values display as whole numbers
5. **Data Integrity**: Proper decimal storage in database

## Testing Checklist

- [ ] Database migration runs successfully
- [ ] Backend processes decimal dimensions correctly
- [ ] Frontend displays formatted dimensions properly
- [ ] Carton dimensions show correctly
- [ ] Product dimensions in orders show correctly
- [ ] Box item dimensions show correctly
- [ ] Table sorting works with decimal values
- [ ] Form inputs accept decimal values
- [ ] Duplicate box functionality works with decimal dimensions

## Files Modified

### Backend
- `backend/db/models.py`
- `backend/services/orders.py`
- `backend/api/packs.py`
- `backend/migrations/update_dimensions_to_decimal.sql` (new)

### Frontend
- `Frontend/vite-project/src/pages/Orders.jsx`
- `Frontend/vite-project/src/pages/Cartons.jsx`

## Notes

- Carton dimensions are typically whole numbers, so they will display as integers
- Product dimensions can now have decimal precision
- The formatting function is reusable and consistent across components
- Database migration is reversible if needed
