from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import PeriodDays, SupportedLanguage, UserResponse


class UserRegister(BaseModel):
    """Schema for user account registration."""
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=6, description="Account password (minimum 6 characters)")
    username: Optional[str] = Field(default=None, max_length=100, description="Optional unique username")
    full_name: Optional[str] = Field(default=None, max_length=255, description="Full name of the user")
    avatar_url: Optional[str] = Field(default=None, description="URL to user avatar image")
    
    # LinkAI Client default configuration
    default_language: SupportedLanguage = Field(
        default="TypeScript",
        description="Default programming language tracked in LinkAI client",
    )
    default_period: PeriodDays = Field(
        default=30,
        description="Default statistics period in days (7, 30, or 90)",
    )
    include_comments: bool = Field(
        default=False,
        description="Whether to include comment lines in code changes count",
    )
    send_aggregated_statistics: bool = Field(
        default=True,
        description="Whether permission to send aggregated statistics to AI backend is enabled",
    )
    excluded_paths: List[str] = Field(
        default_factory=list,
        description="Path substrings or patterns to exclude from statistics",
    )


class UserLogin(BaseModel):
    """Schema for user login with email and password."""
    email: EmailStr = Field(..., description="Registered email address")
    password: str = Field(..., min_length=1, description="Account password")


class Token(BaseModel):
    """Token response returned upon successful registration or login."""
    access_token: str = Field(..., description="JWT Bearer access token for web/API authorization")
    token_type: str = Field(default="bearer", description="Token type")
    api_token: str = Field(..., description="LinkAI client token (configure in VS Code: linkai.setBackendToken)")
    user: UserResponse = Field(..., description="User profile and LinkAI preferences")


class TokenPayload(BaseModel):
    """Payload stored within the JWT access token."""
    sub: str = Field(..., description="User UUID")
    email: Optional[str] = Field(default=None, description="User email")
    exp: Optional[datetime] = Field(default=None, description="Expiration time")
