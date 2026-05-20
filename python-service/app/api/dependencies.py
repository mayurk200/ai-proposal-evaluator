"""
Dependency injection for FastAPI endpoints.
"""

from app.services.llm_client import get_llm_client


def verify_llm_connection() -> bool:
    """Check if the LLM client can be initialized."""
    try:
        client = get_llm_client()
        return client is not None
    except Exception:
        return False
