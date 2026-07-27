"""Shared FastAPI dependencies."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Header

from app.services.llm.llm_client import get_llm_client


@dataclass(frozen=True)
class Actor:
    """
    Who is making this request.

    The Node gateway verifies the JWT and forwards the caller's identity as
    headers. This service sits behind that gateway and is not publicly reachable,
    so it trusts those headers rather than re-implementing JWT verification in a
    second language and a second place.

    `user_id` is threaded all the way through to the audit log and the approval
    ledger — an approval with no name attached to it is not much of an approval.
    """

    user_id: Optional[str] = None
    role: Optional[str] = None

    @property
    def is_admin(self) -> bool:
        return self.role == "ADMIN"


async def get_actor(
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
) -> Actor:
    return Actor(user_id=x_user_id, role=x_user_role)


def verify_llm_connection() -> bool:
    """Cheap check that the LLM is configured. Used by the health endpoint."""
    try:
        return get_llm_client() is not None
    except Exception:
        return False
