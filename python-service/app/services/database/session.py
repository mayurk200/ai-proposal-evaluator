"""
Database engine and session management.

One engine for the whole process. Previously each repository constructed its own
`create_async_engine`, which meant several independent connection pools competing
for the same Postgres — fine at one user, a connection-limit problem at the scale
this system is meant to run at.
"""

from typing import AsyncIterator, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.services.database.models import Base
from app.utils.logging import get_logger

logger = get_logger(__name__)

_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None


def get_engine() -> AsyncEngine:
    """Get (or lazily build) the process-wide async engine."""
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            settings.DATABASE_URL,
            echo=False,
            # Postgres drops idle connections; without this the first query after
            # an idle period fails instead of transparently reconnecting.
            pool_pre_ping=True,
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            pool_recycle=1800,
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Get (or lazily build) the session factory."""
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(),
            expire_on_commit=False,
            class_=AsyncSession,
        )
    return _session_factory


async def session_scope() -> AsyncIterator[AsyncSession]:
    """Async generator yielding a session — for FastAPI dependency injection."""
    factory = get_session_factory()
    async with factory() as session:
        yield session


# Columns added after the first release. `create_all` creates missing *tables*
# but never alters an existing one, so a database seeded by an earlier version
# would come up without these and every query touching them would fail.
#
# Each statement is idempotent, so this runs on every boot and does nothing on a
# database that is already current. That is the whole migration story this
# service needs: the schema only ever grows, and Postgres does these as metadata
# changes without rewriting the table.
_ADDITIVE_MIGRATIONS = (
    "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS duplicate_of_id VARCHAR(36)",
    "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS latest_score DOUBLE PRECISION",
    "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS latest_recommendation VARCHAR(64)",
    "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS latest_evaluation_id VARCHAR(36)",
    "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMP",
    "CREATE INDEX IF NOT EXISTS ix_proposals_duplicate_of ON proposals (duplicate_of_id)",
    "CREATE INDEX IF NOT EXISTS ix_proposals_latest_score ON proposals (latest_score)",
    "CREATE INDEX IF NOT EXISTS ix_proposals_evaluated_at ON proposals (evaluated_at)",
    # Backfill the denormalized verdict from the evaluations that already exist.
    # Without this, every proposal scored before the column was added reads as
    # unscored: it drops out of the score distribution, and sorting the archive
    # by score silently buries the entire back catalogue.
    #
    # Touches only rows that are still NULL, so it is a no-op on the second boot
    # and never overwrites a live value.
    """
    UPDATE proposals AS p
       SET latest_score = e.overall_score,
           latest_recommendation = e.recommendation,
           latest_evaluation_id = e.id,
           evaluated_at = COALESCE(e.completed_at, e.created_at)
      FROM (
            SELECT DISTINCT ON (proposal_id)
                   proposal_id, id, overall_score, recommendation, completed_at, created_at
              FROM evaluations
             WHERE status = 'completed'
             ORDER BY proposal_id, created_at DESC
           ) AS e
     WHERE e.proposal_id = p.id
       AND p.latest_score IS NULL
    """,
)


async def init_db() -> None:
    """
    Create the pgvector extension, then all tables and indexes.

    The extension must exist before `create_all`, because `proposals.embedding`
    is a `vector` column and the DDL for it will not parse otherwise.
    """
    engine = get_engine()

    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        # Trigram index support, used for fuzzy company-name matching alongside
        # the vector search.
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)

    async with engine.begin() as conn:
        for statement in _ADDITIVE_MIGRATIONS:
            await conn.execute(text(statement))

    # The ANN index cannot live in `Base.metadata` because its operator class is
    # pgvector-specific. HNSW over cosine distance: this is what keeps the
    # similarity gate O(log n) instead of a sequential scan over every idea ever
    # submitted — which matters a great deal after a few years of submissions.
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_proposals_embedding_hnsw "
                "ON proposals USING hnsw (embedding vector_cosine_ops)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_companies_name_trgm "
                "ON companies USING gin (name_normalized gin_trgm_ops)"
            )
        )

    logger.info("database_initialized")


async def close_db() -> None:
    """Dispose of the connection pool on shutdown."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
