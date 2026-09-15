from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID
from fastapi import HTTPException, status
from postgrest.exceptions import APIError
from supabase import Client

from app.core.security import generate_linkai_api_token, hash_password, verify_password
from app.db.supabase import get_supabase
from app.schemas.auth import UserRegister
from app.schemas.user import UserCreate, UserInDB, UserResponse, UserUpdate


class UserService:
    """Service layer for managing LinkAI users and authentication in Supabase."""

    def __init__(self, supabase_client: Optional[Client] = None):
        self._client = supabase_client

    @property
    def client(self) -> Client:
        if self._client is None:
            self._client = get_supabase()
        return self._client

    def get_users(self, limit: int = 100, offset: int = 0) -> List[UserResponse]:
        """Fetch list of users with pagination."""
        try:
            response = (
                self.client.table("users")
                .select("*")
                .range(offset, offset + limit - 1)
                .execute()
            )
            return [UserResponse.model_validate(item) for item in response.data]
        except APIError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {e.message}",
            )

    def get_user_by_id(self, user_id: UUID) -> UserResponse:
        """Fetch a single user by UUID."""
        try:
            response = (
                self.client.table("users")
                .select("*")
                .eq("id", str(user_id))
                .execute()
            )
            if not response.data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"User with ID {user_id} not found",
                )
            return UserResponse.model_validate(response.data[0])
        except APIError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {e.message}",
            )

    def get_user_by_email(self, email: str) -> Optional[UserResponse]:
        """Fetch a user by email address."""
        try:
            response = (
                self.client.table("users")
                .select("*")
                .eq("email", email)
                .execute()
            )
            if response.data:
                return UserResponse.model_validate(response.data[0])
            return None
        except APIError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {e.message}",
            )

    def get_user_in_db_by_email(self, email: str) -> Optional[UserInDB]:
        """Fetch a user with password_hash for authentication."""
        try:
            response = (
                self.client.table("users")
                .select("*")
                .eq("email", email)
                .execute()
            )
            if response.data:
                return UserInDB.model_validate(response.data[0])
            return None
        except APIError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {e.message}",
            )

    def get_user_by_token(self, api_token: str) -> Optional[UserResponse]:
        """Fetch a user by LinkAI backend api_token (for VS Code client Bearer auth)."""
        try:
            response = (
                self.client.table("users")
                .select("*")
                .eq("api_token", api_token)
                .execute()
            )
            if response.data:
                return UserResponse.model_validate(response.data[0])
            return None
        except APIError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {e.message}",
            )

    def register_user(self, reg_in: UserRegister) -> UserResponse:
        """Register a new user account with hashed password and LinkAI API token."""
        # 1. Check if user with this email already exists
        existing_user = self.get_user_by_email(reg_in.email)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User with this email already exists",
            )

        # 2. Check if username already exists if provided
        if reg_in.username:
            try:
                res = self.client.table("users").select("id").eq("username", reg_in.username).execute()
                if res.data:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Username is already taken",
                    )
            except APIError:
                pass

        # 3. Hash password and prepare user record
        user_dict: Dict[str, Any] = reg_in.model_dump(exclude={"password"})
        user_dict["password_hash"] = hash_password(reg_in.password)
        user_dict["api_token"] = generate_linkai_api_token()
        user_dict["is_active"] = True

        try:
            response = self.client.table("users").insert(user_dict).execute()
            if not response.data:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to create user account",
                )
            return UserResponse.model_validate(response.data[0])
        except APIError as e:
            if "duplicate key value" in e.message or "unique constraint" in e.message.lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="User with this email or username already exists",
                )
            # If column password_hash does not exist yet, surface clear guidance
            if "password_hash" in e.message and "does not exist" in e.message:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Database column 'password_hash' is missing. Run 'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);' in Supabase SQL editor.",
                )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {e.message}",
            )

    def authenticate_user(self, email: str, password: str) -> Optional[UserResponse]:
        """Authenticate user by email and plaintext password."""
        user_in_db = self.get_user_in_db_by_email(email)
        if not user_in_db:
            return None
        if not user_in_db.password_hash:
            return None
        if not verify_password(password, user_in_db.password_hash):
            return None
        if not user_in_db.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User account is inactive",
            )
        return UserResponse.model_validate(user_in_db)

    def create_user(self, user_in: UserCreate) -> UserResponse:
        """Create a new user with generated api_token if not provided."""
        try:
            user_dict: Dict[str, Any] = user_in.model_dump(exclude_unset=True)
            if "password" in user_dict and user_dict["password"]:
                user_dict["password_hash"] = hash_password(user_dict.pop("password"))
            elif "password" in user_dict:
                user_dict.pop("password")

            if not user_dict.get("api_token"):
                user_dict["api_token"] = generate_linkai_api_token()

            response = self.client.table("users").insert(user_dict).execute()
            if not response.data:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to create user",
                )
            return UserResponse.model_validate(response.data[0])
        except APIError as e:
            if "duplicate key value" in e.message or "unique constraint" in e.message.lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="User with this email, username, or api_token already exists",
                )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {e.message}",
            )

    def update_user(self, user_id: UUID, user_in: UserUpdate) -> UserResponse:
        """Update an existing user."""
        update_data = user_in.model_dump(exclude_unset=True)
        if not update_data:
            return self.get_user_by_id(user_id)

        if "password" in update_data and update_data["password"]:
            update_data["password_hash"] = hash_password(update_data.pop("password"))
        elif "password" in update_data:
            update_data.pop("password")

        try:
            response = (
                self.client.table("users")
                .update(update_data)
                .eq("id", str(user_id))
                .execute()
            )
            if not response.data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"User with ID {user_id} not found",
                )
            return UserResponse.model_validate(response.data[0])
        except APIError as e:
            if "duplicate key value" in e.message or "unique constraint" in e.message.lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="User with this email, username, or api_token already exists",
                )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {e.message}",
            )

    def update_last_check(self, user_id: UUID) -> UserResponse:
        """Update last_check_at timestamp to current UTC time."""
        try:
            response = (
                self.client.table("users")
                .update({"last_check_at": datetime.now(timezone.utc).isoformat()})
                .eq("id", str(user_id))
                .execute()
            )
            if not response.data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"User with ID {user_id} not found",
                )
            return UserResponse.model_validate(response.data[0])
        except APIError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {e.message}",
            )

    def delete_user(self, user_id: UUID) -> None:
        """Delete user by ID from Supabase."""
        try:
            response = (
                self.client.table("users")
                .delete()
                .eq("id", str(user_id))
                .execute()
            )
            if not response.data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"User with ID {user_id} not found",
                )
        except APIError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {e.message}",
            )


user_service = UserService()

