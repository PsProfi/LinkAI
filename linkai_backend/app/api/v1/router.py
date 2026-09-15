from fastapi import APIRouter
from app.api.v1.endpoints import auth, health, users, ai

api_router = APIRouter()

# ── Core endpoints ──────────────────────────────────────────────────────────
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)

# ── AI endpoints (OpenAI integration) ───────────────────────────────────────
api_router.include_router(ai.router)

