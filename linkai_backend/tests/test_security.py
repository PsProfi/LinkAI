import pytest
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    generate_linkai_api_token,
)


class TestSecurity:
    def test_password_hashing_and_verification(self):
        plain = "SuperSecretPassword123!"
        hashed = hash_password(plain)

        assert hashed.startswith("pbkdf2_sha256$600000$")
        assert verify_password(plain, hashed) is True
        assert verify_password("WrongPassword!", hashed) is False
        assert verify_password("", hashed) is False
        assert verify_password(plain, "") is False
        assert verify_password(plain, "invalid$format") is False

    def test_jwt_token_flow(self):
        user_id = "12345678-1234-5678-1234-567812345678"
        extra = {"email": "dev@linkai.com", "role": "developer"}
        
        token = create_access_token(subject=user_id, extra_claims=extra)
        assert isinstance(token, str)
        assert len(token) > 0

        decoded = decode_access_token(token)
        assert decoded is not None
        assert decoded["sub"] == user_id
        assert decoded["email"] == "dev@linkai.com"
        assert decoded["role"] == "developer"
        assert "exp" in decoded
        assert "iat" in decoded

    def test_invalid_jwt_decoding(self):
        assert decode_access_token("invalid.jwt.token") is None
        assert decode_access_token("") is None

    def test_generate_linkai_api_token(self):
        token1 = generate_linkai_api_token()
        token2 = generate_linkai_api_token()
        assert token1.startswith("lai_")
        assert token2.startswith("lai_")
        assert token1 != token2
        assert len(token1) > 20
