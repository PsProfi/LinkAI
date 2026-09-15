"""
AiService — взаємодія з AI-провайдером для оцінки статистики кодування.

Підтримувані провайдери (перемикається через AI_PROVIDER у .env):
  - "gemini"  → Google Gemini 2.5 Flash (безкоштовний tier)
               через OpenAI-сумісний endpoint, без окремого SDK
  - "openai"  → OpenAI GPT-4o-mini з автоматичним fallback на Gemini
               якщо OpenAI повертає 401 (вичерпаний баланс / невалідний ключ)

Системний промпт налаштований під метрики linkai client (VSCode extension).
"""

import asyncio
import json
import logging
from openai import AsyncOpenAI, AuthenticationError
from openai import APIError, APIConnectionError, APITimeoutError, RateLimitError

from app.core.config import settings
from app.schemas.ai import AiEvaluation, AiRequest

logger = logging.getLogger("linkai.ai")

# ---------------------------------------------------------------------------
# Системний промпт
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are an expert software development coach embedded in the LinkAI VS Code extension.
Your role is to analyze a developer's aggregated coding activity metrics and provide
a concise, motivating evaluation with actionable recommendations.

# Input
You receive JSON with:
- `language` — the programming language being analyzed
- `periodDays` — duration of the analyzed period (7, 30, or 90 days)
- `current` — aggregated stats for the CURRENT period:
    - `linesAdded` — lines of code added
    - `linesDeleted` — lines of code deleted
    - `linesChanged` — total lines changed (added + deleted)
    - `activeDays` — days with at least one coding session
    - `sessions` — number of distinct coding sessions (gap > 30 min separates sessions)
    - `averageLinesPerActiveDay` — average lines added per active day
- `previous` — same stats for the PREVIOUS identical period (for comparison)

# Output
Respond ONLY with a valid JSON object matching this exact shape:
{
  "score": <integer 0–100>,
  "trend": "<improving | stable | declining>",
  "summary": "<1–3 sentence summary in Ukrainian>",
  "strengths": ["<strength 1>", ...],          // up to 6 items, in Ukrainian
  "recommendations": ["<recommendation 1>", ...], // up to 4 items, in Ukrainian
  "confidence": "<low | medium | high>"
}

# Scoring guidelines
- 80–100: Excellent consistency, high volume, regular sessions
- 60–79:  Good activity with room for improvement
- 40–59:  Moderate activity, noticeable gaps
- 20–39:  Low activity, needs more regular practice
- 0–19:   Very low activity (fewer than 2 active days in the period)

# Trend logic
- "improving": current period shows ≥10% increase in linesAdded OR activeDays vs previous
- "declining": current period shows ≥10% decrease in linesAdded OR activeDays vs previous
- "stable": otherwise

# Confidence logic
- "high": current.activeDays >= 5 AND current.sessions >= 8
- "medium": current.activeDays >= 2 AND current.sessions >= 3
- "low": less data than above thresholds

# Important rules
1. Write `summary`, `strengths`, and `recommendations` in Ukrainian.
2. Be specific — reference actual numbers from the input.
3. Strengths should acknowledge real positives; do not invent them if data is sparse.
4. Recommendations must be concrete and actionable (e.g., "Збільшити кількість активних днів до 5 на тиждень").
5. Never return markdown — only plain JSON.
6. If `current.activeDays` is 0, set score ≤ 5 and confidence to "low".
"""

# ---------------------------------------------------------------------------
# Конфігурація клієнтів
# ---------------------------------------------------------------------------

# Gemini використовує OpenAI-сумісний endpoint — окремий SDK не потрібен.
_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


def _build_openai_client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


def _build_gemini_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.GEMINI_API_KEY,
        base_url=_GEMINI_BASE_URL,
    )


def _extract_json(raw: str) -> str:
    """
    Gemini іноді повертає JSON обгорнутий у markdown-блок:
      ```json\n{...}\n```
    або просто:  ```\n{...}\n```
    Ця функція витягує чистий JSON-рядок.
    """
    raw = raw.strip()
    # Прибираємо markdown-огорожу ```json ... ``` або ``` ... ```
    if raw.startswith("```"):
        # Відрізаємо першу лінію з мовою (```json або ```)
        raw = raw.split("\n", 1)[-1]
        # Відрізаємо закриваючі ```
        if raw.endswith("```"):
            raw = raw[: raw.rfind("```")]
    return raw.strip()


# ---------------------------------------------------------------------------
# Retry налаштування
# ---------------------------------------------------------------------------

# Максимальна кількість спроб (включаючи першу)
_MAX_RETRIES: int = 3
# Базова затримка між спробами (сек.) — зростає експоненціально: 2→ 4 → 8
_RETRY_BASE_DELAY: float = 2.0
# Максимальна затримка між спробами
_RETRY_MAX_DELAY: float = 16.0

# Помилки, що варто повторити (перевантаження та таймаути)
_RETRYABLE_ERRORS = (RateLimitError, APITimeoutError, APIConnectionError)

# ---------------------------------------------------------------------------
# AiService
# ---------------------------------------------------------------------------

class AiService:
    """
    Сервіс для взаємодії з AI-провайдером.

    Ініціалізація клієнтів визначається змінною AI_PROVIDER у .env:
      - "gemini"  → використовує Gemini як єдиний провайдер
      - "openai"  → використовує OpenAI з автоматичним fallback на Gemini
                    при AuthenticationError (401 — вичерпаний баланс або невалідний ключ)
    """

    def __init__(self) -> None:
        # Обидва клієнти завжди ініціалізуються (fallback потребує обох)
        self._openai_client = _build_openai_client()
        self._gemini_client = _build_gemini_client()

    async def evaluate(self, request: AiRequest) -> AiEvaluation:
        """
        Оцінити прогрес розробника через обраний AI-провайдер.

        Raises:
            ValueError: відповідь AI не відповідає очікуваній структурі.
            RuntimeError: мережева або API помилка без можливості відновлення.
        """
        provider = settings.AI_PROVIDER.lower().strip()

        if provider == "gemini":
            logger.info("AI provider: Gemini (primary)")
            return await self._call(
                client=self._gemini_client,
                model=settings.GEMINI_MODEL,
                request=request,
                provider_name="Gemini",
            )

        # openai — основний, fallback → gemini при AuthenticationError (401)
        logger.info("AI provider: OpenAI (primary)")
        try:
            return await self._call(
                client=self._openai_client,
                model=settings.OPENAI_MODEL,
                request=request,
                provider_name="OpenAI",
            )
        except AuthenticationError as exc:
            logger.warning(
                "OpenAI returned 401 (balance/key issue) — switching to Gemini fallback. "
                "Error: %s",
                exc,
            )
            logger.info("AI provider: Gemini (fallback)")
            return await self._call(
                client=self._gemini_client,
                model=settings.GEMINI_MODEL,
                request=request,
                provider_name="Gemini (fallback)",
            )

    async def _call(
        self,
        client: AsyncOpenAI,
        model: str,
        request: AiRequest,
        provider_name: str,
    ) -> AiEvaluation:
        """Виконати запит до конкретного клієнта z retry та розбіром відповіді."""
        user_message = json.dumps(request.model_dump(), ensure_ascii=False)
        last_exc: Exception | None = None

        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                response = await client.chat.completions.create(
                    model=model,
                    temperature=settings.OPENAI_TEMPERATURE,
                    # 2048 достатньо для повної відповіді Gemini без обрізання
                    max_tokens=max(settings.OPENAI_MAX_TOKENS, 2048),
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_message},
                    ],
                )
                # Успіх — виходимо з циклу
                break

            except AuthenticationError:
                # Не повторюємо — обробляється в evaluate() для fallback
                raise

            except _RETRYABLE_ERRORS as exc:
                last_exc = exc
                delay = min(_RETRY_BASE_DELAY * (2 ** (attempt - 1)), _RETRY_MAX_DELAY)
                if attempt < _MAX_RETRIES:
                    logger.warning(
                        "%s transient error (attempt %d/%d), retrying in %.0fs: %s",
                        provider_name, attempt, _MAX_RETRIES, delay, exc,
                    )
                    await asyncio.sleep(delay)
                    continue
                # Всі спроби вичерпано
                logger.error(
                    "%s failed after %d retries: %s", provider_name, _MAX_RETRIES, exc
                )
                raise RuntimeError(
                    f"AI-сервіс ({provider_name}) недоступний після {_MAX_RETRIES} спроб. Спробуйте пізніше."
                ) from exc

            except APIError as exc:
                logger.error("%s API error: %s", provider_name, exc)
                raise RuntimeError(f"Помилка AI-сервісу ({provider_name}): {exc.message}") from exc

        raw = response.choices[0].message.content or ""
        clean = _extract_json(raw)

        try:
            data = json.loads(clean)
        except json.JSONDecodeError as exc:
            logger.error(
                "Failed to parse %s JSON response: %s | raw=%s",
                provider_name, exc, raw[:500],
            )
            raise ValueError("AI повернув некоректний формат відповіді.") from exc

        try:
            evaluation = AiEvaluation(
                score=int(round(data.get("score", 0))),
                trend=data.get("trend", "stable"),
                summary=str(data.get("summary", "")),
                strengths=[str(s) for s in data.get("strengths", [])[:6]],
                recommendations=[str(r) for r in data.get("recommendations", [])[:4]],
                confidence=data.get("confidence", "medium"),
            )
        except Exception as exc:
            logger.error(
                "AiEvaluation validation error (%s): %s | data=%s",
                provider_name, exc, data,
            )
            raise ValueError("AI повернув неповну або невалідну відповідь.") from exc

        logger.info(
            "AI evaluation (%s): lang=%s period=%d score=%d trend=%s confidence=%s",
            provider_name,
            request.language,
            request.periodDays,
            evaluation.score,
            evaluation.trend,
            evaluation.confidence,
        )
        return evaluation
