"""Database service package — the single system of record."""

from app.services.database.proposal_repository import (
    ProposalRepository,
    get_proposal_repository,
)
from app.services.database.registry_repository import (
    RegistryRepository,
    get_registry_repository,
    normalize_company_name,
    slugify,
)
from app.services.database.repository import EvaluationRepository, get_repository
from app.services.database.session import close_db, get_engine, init_db

__all__ = [
    "EvaluationRepository",
    "ProposalRepository",
    "RegistryRepository",
    "close_db",
    "get_engine",
    "get_proposal_repository",
    "get_registry_repository",
    "get_repository",
    "init_db",
    "normalize_company_name",
    "slugify",
]
