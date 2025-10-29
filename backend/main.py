from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from backend.core.config import get_settings
from backend.api import orders , cartons, packs, health, auth
settings = get_settings()

app = FastAPI(title="Packaging App Backend")

# --- CORS (so React frontend can call APIs) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # React dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Root route (test) ---
@app.get("/")
def root():
    return {"message": "Backend running!"}

# --- Exception handlers ---
@app.exception_handler(ValueError)
def value_error_exception_handler(request, exc):
    return JSONResponse(
        status_code=400,
        content={"detail": str(exc)},
    )
# --- Include API routers ---
# from backend.api import orders, packs, cartons
app.include_router(auth.router, tags=["auth"])
app.include_router(orders.router, tags=["orders"])
app.include_router(packs.router, tags=["pack"])
app.include_router(cartons.router, tags=["cartons"])
app.include_router(health.router, tags=["system"])
