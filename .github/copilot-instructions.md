# AI Coding Agent Guidelines for Packaging App

## Overview
This project consists of a **React frontend** and a **FastAPI backend**. The application is designed to manage packaging workflows, including cartons, orders, and packing operations. The backend interacts with two databases: an application database and a read-only OES database.

### Key Components
- **Frontend**: Located in `Frontend/vite-project/`, built with React and Vite.
- **Backend**: Located in `backend/`, built with FastAPI and SQLAlchemy.
- **Databases**:
  - `APP_DATABASE_URL`: Application database for storing orders, packs, and cartons.
  - `OES_DATABASE_URL`: Read-only database for fetching order data.

## Backend Architecture
- **API Modules**:
  - `api/orders.py`: Handles order-related endpoints.
  - `api/cartons.py`: Manages carton-related endpoints.
  - `api/packs.py`: Manages packing operations.
  - `api/health.py`: Provides a health check endpoint.
- **Services**:
  - `services/cartons.py`: Business logic for cartons.
  - `services/orders.py`: Ensures orders are synced between the app and OES.
  - `services/pack_view.py`: Handles packing snapshots and integrity checks.
- **Database Models**:
  - Defined in `db/models.py`.
  - Includes `Order`, `OrderLine`, `Pack`, `PackBox`, `CartonType`, etc.
- **Configuration**:
  - Managed via `core/config.py`.
  - Environment variables are loaded from `.env`.

## Frontend Architecture
- **Pages**:
  - `src/pages/Orders.jsx`: Manages order workflows.
  - `src/pages/Cartons.jsx`: Handles carton management.
  - `src/pages/Packs.jsx`: Displays packing operations.
- **API Integration**:
  - `src/api/orders.js`: Fetches and syncs orders.
  - `src/api/cartons.js`: Manages carton-related API calls.
  - `src/api/packs.js`: Handles packing-related API calls.
- **Styling**:
  - Global styles in `src/index.css`.
  - Component-specific styles in `src/App.css`.

## Developer Workflows
### Backend
1. **Run the Backend**:
   ```bash
   uvicorn backend.main:app --reload
   ```
2. **Test Endpoints**:
   Use tools like Postman or cURL to test endpoints (e.g., `http://localhost:8000/api/orders`).
3. **Database Migrations**:
   Use Alembic for schema migrations (not yet configured).

### Frontend
1. **Run the Frontend**:
   ```bash
   npm run dev
   ```
2. **Linting**:
   ```bash
   npm run lint
   ```
3. **Build for Production**:
   ```bash
   npm run build
   ```

## Project-Specific Conventions
- **Backend**:
  - Use SQLAlchemy ORM for database interactions.
  - Raise `ValueError` for business logic errors; these are converted to HTTP 400 responses.
  - Use `services/` for business logic to keep API routes thin.
- **Frontend**:
  - Use Ant Design components for UI consistency.
  - API calls are centralized in `src/api/`.
  - Use `useState` and `useEffect` for state management.

## Integration Points
- **Frontend to Backend**:
  - The frontend communicates with the backend via REST APIs.
  - Example: `src/api/orders.js` calls `/api/orders` endpoints.
- **Backend to Databases**:
  - The backend uses SQLAlchemy to interact with the application database.
  - The OES database is read-only and queried directly using raw SQL.

## Examples
### Backend: Adding a New API Endpoint
1. Create a new file in `backend/api/` (e.g., `new_feature.py`).
2. Define the route using FastAPI:
   ```python
   from fastapi import APIRouter

   router = APIRouter(prefix="/api/new-feature")

   @router.get("/")
   def get_new_feature():
       return {"message": "New feature"}
   ```
3. Include the router in `backend/main.py`:
   ```python
   from backend.api import new_feature
   app.include_router(new_feature.router)
   ```

### Frontend: Adding a New Page
1. Create a new file in `src/pages/` (e.g., `NewFeature.jsx`).
2. Define the component:
   ```jsx
   import React from "react";

   export default function NewFeature() {
       return <div>New Feature</div>;
   }
   ```
3. Add a route in `src/App.jsx`:
   ```jsx
   import NewFeature from "./pages/NewFeature";

   <Route path="/new-feature" element={<NewFeature />} />
   ```

## Notes
- Ensure `.env` is configured correctly for database connections.
- Use `http://localhost:5173` as the frontend URL during development.
- Follow the existing patterns for consistency.