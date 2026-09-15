from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr, Field

# Співпадає з supportedLanguages у linkai client/src/types/statistics.ts
SupportedLanguage = Literal[
    "TypeScript",
    "JavaScript",
    "Python",
    "Java",
    "C#",
    "Go",
    "C++",
    "Інша",
]

# Співпадає з PeriodDays у linkai client/src/types/statistics.ts
PeriodDays = Literal[7, 30, 90]


class UserBase(BaseModel):
    email: EmailStr = Field(..., description="User email address")
    username: Optional[str] = Field(default=None, max_length=100, description="Unique username")
    full_name: Optional[str] = Field(default=None, max_length=255, description="Full name of the user")
    avatar_url: Optional[str] = Field(default=None, description="URL to user avatar image")
    
    # Налаштування розширення LinkAI Client (з VS Code settings)
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
    is_active: bool = Field(default=True, description="Account active status")


class UserCreate(UserBase):
    password: Optional[str] = Field(
        default=None,
        min_length=6,
        description="User plaintext password (will be hashed before storage)",
    )
    api_token: Optional[str] = Field(
        default=None,
        description="Optional custom API token for LinkAI client Bearer authentication. If omitted, will be generated.",
    )


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = Field(default=None, description="User email address")
    password: Optional[str] = Field(default=None, min_length=6, description="Update password")
    username: Optional[str] = Field(default=None, max_length=100, description="Unique username")
    full_name: Optional[str] = Field(default=None, max_length=255, description="Full name of the user")
    avatar_url: Optional[str] = Field(default=None, description="URL to user avatar image")
    default_language: Optional[SupportedLanguage] = Field(default=None, description="Default programming language")
    default_period: Optional[PeriodDays] = Field(default=None, description="Default period (7, 30, 90)")
    include_comments: Optional[bool] = Field(default=None, description="Include comment lines in stats")
    send_aggregated_statistics: Optional[bool] = Field(default=None, description="Permission to send stats to AI")
    excluded_paths: Optional[List[str]] = Field(default=None, description="Excluded paths list")
    api_token: Optional[str] = Field(default=None, description="API token for LinkAI client authentication")
    is_active: Optional[bool] = Field(default=None, description="Account active status")
    last_check_at: Optional[datetime] = Field(default=None, description="Timestamp of last AI evaluation check")


class UserResponse(UserBase):
    id: UUID
    api_token: Optional[str] = Field(default=None, description="API token for LinkAI client authentication")
    last_check_at: Optional[datetime] = Field(default=None, description="Timestamp of last check")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserInDB(UserResponse):
    password_hash: Optional[str] = Field(default=None, description="Hashed password for authentication")

