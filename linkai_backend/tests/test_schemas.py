import pytest
from pydantic import ValidationError
from app.schemas.ai import AiRequest, AiEvaluation, Summary
from app.schemas.auth import UserLogin, UserRegister
from app.schemas.user import UserCreate, UserUpdate


class TestSchemas:
    def test_summary_and_ai_request_schema(self):
        summary_curr = Summary(
            linesAdded=100,
            linesDeleted=20,
            linesChanged=120,
            activeDays=5,
            sessions=8,
            averageLinesPerActiveDay=20.0,
        )
        summary_prev = Summary(
            linesAdded=80,
            linesDeleted=10,
            linesChanged=90,
            activeDays=4,
            sessions=6,
            averageLinesPerActiveDay=20.0,
        )
        req = AiRequest(
            language="TypeScript",
            periodDays=30,
            current=summary_curr,
            previous=summary_prev,
        )
        assert req.language == "TypeScript"
        assert req.periodDays == 30
        assert req.current.linesAdded == 100

    def test_ai_evaluation_schema_validation(self):
        evaluation = AiEvaluation(
            score=88,
            trend="improving",
            summary="Чудовий прогрес!",
            strengths=["Регулярні коміти"],
            recommendations=["Додати юніт тести"],
            confidence="high",
        )
        assert evaluation.score == 88
        assert evaluation.trend == "improving"
        assert evaluation.confidence == "high"

    def test_user_schemas_validation(self):
        reg = UserRegister(
            email="test@linkai.dev",
            password="SecurePassword999!",
            username="tester",
        )
        assert reg.email == "test@linkai.dev"
        assert reg.password == "SecurePassword999!"

        update = UserUpdate(
            default_language="Python",
            default_period=7,
            include_comments=True,
        )
        assert update.default_language == "Python"
        assert update.default_period == 7
        assert update.include_comments is True
