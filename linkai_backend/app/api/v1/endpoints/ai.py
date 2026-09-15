"""
AI endpoints — секція для взаємодії з OpenAI.

Ендпоінти відповідають тому, що очікує linkai client (src/services/aiClient.ts):
  POST /api/v1/ai/evaluate  ← головний ендпоінт оцінки прогресу

Аутентифікація: Bearer token (JWT або LinkAI API token через deps.get_current_active_user).
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_active_user
from app.schemas.ai import AiEvaluation, AiRequest
from app.schemas.user import UserResponse
from app.services.ai_service import AiService

logger = logging.getLogger("linkai.ai")

router = APIRouter(
    prefix="/ai",
    tags=["AI — Оцінка прогресу розробника"],
)


def get_ai_service() -> AiService:
    """Dependency для AiService."""
    return AiService()


# ---------------------------------------------------------------------------
# POST /ai/evaluate
# ---------------------------------------------------------------------------

@router.post(
    "/evaluate",
    response_model=AiEvaluation,
    summary="Оцінити прогрес розробника за допомогою OpenAI",
    description=(
        "Приймає агреговану статистику активності з linkai VSCode extension "
        "та повертає AI-оцінку прогресу: загальний бал, тренд, сильні сторони "
        "та рекомендації для покращення."
    ),
)
async def evaluate_progress(
    request: AiRequest,
    current_user: UserResponse = Depends(get_current_active_user),
    ai_service: AiService = Depends(get_ai_service),
) -> AiEvaluation:
    """
    **Вхід (AiRequest):**
    - `language` — мова програмування (TypeScript, Python, тощо)
    - `periodDays` — тривалість аналізованого періоду: 7, 30 або 90 днів
    - `current` — Summary за поточний період
    - `previous` — Summary за попередній аналогічний період

    **Вихід (AiEvaluation):**
    - `score` — оцінка від 0 до 100
    - `trend` — `improving` | `stable` | `declining`
    - `summary` — короткий текстовий підсумок (українською)
    - `strengths` — список сильних сторін (до 6)
    - `recommendations` — список рекомендацій (до 4)
    - `confidence` — `low` | `medium` | `high`
    """
    logger.info(
        "AI evaluate request: user=%s lang=%s period=%d",
        current_user.id,
        request.language,
        request.periodDays,
    )

    try:
        evaluation = await ai_service.evaluate(request)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return evaluation
