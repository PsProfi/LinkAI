from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user, get_user_service
from app.core.security import create_access_token
from app.schemas.auth import Token, UserLogin, UserRegister
from app.schemas.user import UserResponse
from app.services.user_service import UserService

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(
    register_in: UserRegister,
    user_srv: UserService = Depends(get_user_service),
):
    """Register a new user account with LinkAI client preferences and password."""
    user = user_srv.register_user(register_in)
    access_token = create_access_token(
        subject=user.id,
        extra_claims={"email": user.email},
    )
    return Token(
        access_token=access_token,
        token_type="bearer",
        api_token=user.api_token or "",
        user=user,
    )


@router.post("/login", response_model=Token)
def login(
    login_in: UserLogin,
    user_srv: UserService = Depends(get_user_service),
):
    """Authenticate user with email and password to receive JWT and LinkAI API tokens."""
    user = user_srv.authenticate_user(login_in.email, login_in.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(
        subject=user.id,
        extra_claims={"email": user.email},
    )
    return Token(
        access_token=access_token,
        token_type="bearer",
        api_token=user.api_token or "",
        user=user,
    )


@router.get("/me", response_model=UserResponse)
def get_current_authenticated_user(
    current_user: UserResponse = Depends(get_current_user),
):
    """Retrieve profile and settings for the currently authenticated user."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide Authorization: Bearer <token>",
        )
    return current_user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_current_user_account(
    current_user: UserResponse = Depends(get_current_user),
    user_srv: UserService = Depends(get_user_service),
):
    """Delete the currently authenticated user's account from the database."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide Authorization: Bearer <token>",
        )
    user_srv.delete_user(current_user.id)
    return None
