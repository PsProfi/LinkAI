import secrets
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_user, get_user_service
from app.core.security import generate_linkai_api_token
from app.schemas.user import UserCreate, UserResponse, UserUpdate
from app.services.user_service import UserService

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me", response_model=UserResponse)
def get_current_user_profile(
    current_user: UserResponse = Depends(get_current_user),
):
    """Get profile and settings for the authenticated LinkAI client user."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide Authorization: Bearer <token>",
        )
    return current_user


@router.patch("/me", response_model=UserResponse)
def update_current_user_profile(
    user_in: UserUpdate,
    current_user: UserResponse = Depends(get_current_user),
    user_srv: UserService = Depends(get_user_service),
):
    """Update settings (language, period, comments, etc.) for current user."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide Authorization: Bearer <token>",
        )
    return user_srv.update_user(current_user.id, user_in)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_current_user_profile(
    current_user: UserResponse = Depends(get_current_user),
    user_srv: UserService = Depends(get_user_service),
):
    """Delete currently authenticated user account."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide Authorization: Bearer <token>",
        )
    user_srv.delete_user(current_user.id)
    return None


@router.post("/me/token/regenerate", response_model=UserResponse)
def regenerate_api_token(
    current_user: UserResponse = Depends(get_current_user),
    user_srv: UserService = Depends(get_user_service),
):
    """Regenerate LinkAI Client backend token for current user."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide Authorization: Bearer <token>",
        )
    new_token = generate_linkai_api_token()
    return user_srv.update_user(current_user.id, UserUpdate(api_token=new_token))  # type: ignore



@router.get("/", response_model=List[UserResponse])
def list_users(
    limit: int = Query(default=100, ge=1, le=500, description="Number of users to return"),
    offset: int = Query(default=0, ge=0, description="Offset from start"),
    user_srv: UserService = Depends(get_user_service),
):
    """Retrieve a paginated list of users from Supabase."""
    return user_srv.get_users(limit=limit, offset=offset)


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: UserCreate,
    user_srv: UserService = Depends(get_user_service),
):
    """Create a new user with LinkAI preferences in Supabase."""
    return user_srv.create_user(user_in)


@router.get("/{user_id}", response_model=UserResponse)
def get_user_by_id(
    user_id: UUID,
    user_srv: UserService = Depends(get_user_service),
):
    """Get user details by UUID."""
    return user_srv.get_user_by_id(user_id)


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: UUID,
    user_in: UserUpdate,
    user_srv: UserService = Depends(get_user_service),
):
    """Update user information and LinkAI settings in Supabase."""
    return user_srv.update_user(user_id, user_in)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    user_srv: UserService = Depends(get_user_service),
):
    """Delete a user by UUID."""
    user_srv.delete_user(user_id)
    return None
