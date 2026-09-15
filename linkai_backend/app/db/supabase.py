from typing import Optional
from supabase import Client, create_client
from app.core.config import settings


class SupabaseManager:
    """Manages the Supabase client instance."""

    _client: Optional[Client] = None

    @classmethod
    def get_client(cls) -> Client:
        """Returns singleton Supabase client instance.
        
        Raises ValueError if SUPABASE_URL or SUPABASE_KEY is missing.
        """
        if cls._client is None:
            if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
                raise ValueError(
                    "SUPABASE_URL and SUPABASE_KEY must be set in your .env file."
                )
            cls._client = create_client(
                supabase_url=settings.SUPABASE_URL,
                supabase_key=settings.SUPABASE_KEY,
            )
        return cls._client


def get_supabase() -> Client:
    """FastAPI Dependency for accessing Supabase client."""
    return SupabaseManager.get_client()
