"""
AI schemas — точно відповідають типам фронтенду linkai client.

Фронтенд (src/types/messages.ts):
  interface AiRequest { language, periodDays, current: Summary, previous: Summary }

Фронтенд (src/types/statistics.ts):
  interface AiEvaluation { score, trend, summary, strengths, recommendations, confidence }
  interface Summary { linesAdded, linesDeleted, linesChanged, activeDays, sessions, averageLinesPerActiveDay }
"""

from typing import Literal
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Вхідні дані (те, що надсилає linkai client)
# ---------------------------------------------------------------------------

class Summary(BaseModel):
    """Агрегована статистика за один часовий відрізок."""
    linesAdded: int = Field(..., ge=0, description="Кількість доданих рядків коду")
    linesDeleted: int = Field(..., ge=0, description="Кількість видалених рядків коду")
    linesChanged: int = Field(..., ge=0, description="Загальна кількість змінених рядків")
    activeDays: int = Field(..., ge=0, description="Кількість днів з активністю")
    sessions: int = Field(..., ge=0, description="Кількість сесій кодування")
    averageLinesPerActiveDay: float = Field(..., ge=0, description="Середня кількість рядків за активний день")


class AiRequest(BaseModel):
    """
    Тіло запиту від linkai client (src/types/messages.ts → AiRequest).
    Містить поточну та попередню статистику для порівняльного аналізу.
    """
    language: str = Field(..., description="Мова програмування (наприклад, TypeScript, Python)")
    periodDays: Literal[7, 30, 90] = Field(..., description="Тривалість аналізованого періоду в днях")
    current: Summary = Field(..., description="Статистика за поточний період")
    previous: Summary = Field(..., description="Статистика за попередній аналогічний період")


# ---------------------------------------------------------------------------
# Вихідні дані (те, що отримує linkai client)
# ---------------------------------------------------------------------------

class AiEvaluation(BaseModel):
    """
    Відповідь AI (src/types/statistics.ts → AiEvaluation).
    Валідаційні умови відповідають перевіркам у aiClient.ts.
    """
    score: int = Field(..., ge=0, le=100, description="Загальна оцінка прогресу від 0 до 100")
    trend: Literal["improving", "stable", "declining"] = Field(
        ..., description="Напрямок тренду відносно попереднього періоду"
    )
    summary: str = Field(..., description="Короткий текстовий підсумок (1–3 речення)")
    strengths: list[str] = Field(
        default_factory=list,
        max_length=6,
        description="Список сильних сторін (до 6 пунктів)",
    )
    recommendations: list[str] = Field(
        ...,
        max_length=4,
        description="Список рекомендацій для покращення (до 4 пунктів)",
    )
    confidence: Literal["low", "medium", "high"] = Field(
        ..., description="Рівень впевненості AI у своїй оцінці"
    )
