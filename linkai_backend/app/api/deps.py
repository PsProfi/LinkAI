from typing import Optional
from uuid import UUID
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client

from app.core.security import decode_access_token
from app.db.supabase import get_supabase
from app.schemas.user import UserResponse
from app.services.user_service import UserService

security = HTTPBearer(auto_error=False)


def get_supabase_client() -> Client:
    """Dependency for Supabase Client."""
    return get_supabase()


def get_user_service() -> UserService:
    """Dependency for UserService."""
    return UserService()


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
    user_srv: UserService = Depends(get_user_service),
) -> Optional[UserResponse]:
    """Retrieve user authenticated via either JWT Bearer token or LinkAI client API token."""
    if not credentials:
        return None
    token = credentials.credentials.strip()

    # 1. Try decoding as JWT access token
    payload = decode_access_token(token)
    if payload and "sub" in payload:
        try:
            user_id = UUID(str(payload["sub"]))
            return user_srv.get_user_by_id(user_id)
        except (ValueError, HTTPException):
            pass

    # 2. Try looking up as LinkAI API token (lai_...)
    user = user_srv.get_user_by_token(token)
    if user:
        return user

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_active_user(
    current_user: Optional[UserResponse] = Depends(get_current_user),
) -> UserResponse:
    """Require an authenticated and active user."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user account",
        )
    return current_user

