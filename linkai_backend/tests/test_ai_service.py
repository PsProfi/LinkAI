import pytest
from app.services.ai_service import _extract_json, SYSTEM_PROMPT


class TestAiServiceUnit:
    def test_extract_json_markdown_fences(self):
        markdown_json = "```json\n{\"score\": 85, \"trend\": \"improving\"}\n```"
        extracted = _extract_json(markdown_json)
        assert extracted == "{\"score\": 85, \"trend\": \"improving\"}"

    def test_extract_json_generic_fences(self):
        raw_fences = "```\n{\"score\": 70}\n```"
        extracted = _extract_json(raw_fences)
        assert extracted == "{\"score\": 70}"

    def test_extract_json_plain(self):
        plain = "  {\"score\": 90}  "
        extracted = _extract_json(plain)
        assert extracted == "{\"score\": 90}"

    def test_system_prompt_contains_critical_rules(self):
        assert "score" in SYSTEM_PROMPT
        assert "trend" in SYSTEM_PROMPT
        assert "Ukrainian" in SYSTEM_PROMPT
        assert "confidence" in SYSTEM_PROMPT
