"""
Async repository for evaluation persistence using SQLAlchemy + asyncpg.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.config import settings
from app.services.database.models import Base, EvaluationRecord
from app.utils.logging import get_logger

logger = get_logger(__name__)


def utc_now_naive() -> datetime:
    """Return UTC as a naive datetime for the existing timestamp columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EvaluationRepository:
    """CRUD operations for evaluation records."""

    def __init__(self, database_url: Optional[str] = None):
        self._url = database_url or settings.DATABASE_URL
        self._engine = create_async_engine(self._url, echo=False, pool_pre_ping=True)
        self._session_factory = async_sessionmaker(self._engine, expire_on_commit=False)

    async def init_tables(self) -> None:
        """Create tables if they don't exist."""
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("database_tables_initialized")

    async def close(self) -> None:
        """Dispose of the engine connection pool."""
        await self._engine.dispose()

    # ----- Create -----

    async def save_evaluation(
        self,
        filename: str,
        file_storage_key: str = "",
        file_storage_url: str = "",
        file_size_bytes: int = 0,
        file_content_type: str = "application/octet-stream",
        overall_score: float = 0.0,
        recommendation: str = "Not Recommended",
        evaluation_report: Optional[dict] = None,
        document_metadata: Optional[dict] = None,
        status: str = "completed",
        error_message: Optional[str] = None,
        batch_id: Optional[str] = None,
        file_hash: Optional[str] = None,
        processing_stage: Optional[str] = None,
        failure_status: Optional[str] = None,
        error_code: Optional[str] = None,
        retry_count: int = 0,
        worker_id: Optional[str] = None,
        started_at: Optional[datetime] = None,
    ) -> str:
        """Save an evaluation record and return the generated ID."""
        record_id = str(uuid.uuid4())

        record = EvaluationRecord(
            id=record_id,
            filename=filename,
            file_storage_key=file_storage_key,
            file_storage_url=file_storage_url,
            file_size_bytes=file_size_bytes,
            file_content_type=file_content_type,
            overall_score=overall_score,
            recommendation=recommendation,
            evaluation_report=json.dumps(evaluation_report) if evaluation_report else None,
            document_metadata=json.dumps(document_metadata) if document_metadata else None,
            status=status,
            error_message=error_message,
            batch_id=batch_id,
            file_hash=file_hash,
            processing_stage=processing_stage,
            failure_status=failure_status,
            error_code=error_code,
            retry_count=retry_count,
            worker_id=worker_id,
            created_at=utc_now_naive(),
            started_at=started_at,
            completed_at=utc_now_naive() if status == "completed" else None,
        )

        async with self._session_factory() as session:
            session.add(record)
            await session.commit()

        logger.info("evaluation_saved", id=record_id, filename=filename, score=overall_score)
        return record_id

    # ----- Read -----

    async def get_evaluation(self, evaluation_id: str) -> Optional[dict]:
        """Get a single evaluation record by ID."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(EvaluationRecord).where(EvaluationRecord.id == evaluation_id)
            )
            record = result.scalar_one_or_none()
            if record is None:
                return None
            return self._record_to_dict(record)

    async def list_evaluations(
        self,
        page: int = 1,
        limit: int = 20,
        status: Optional[str] = None,
    ) -> dict:
        """List evaluations with pagination."""
        async with self._session_factory() as session:
            query = select(EvaluationRecord).order_by(EvaluationRecord.created_at.desc())

            if status:
                query = query.where(EvaluationRecord.status == status)

            # Count total
            from sqlalchemy import func
            count_query = select(func.count()).select_from(EvaluationRecord)
            if status:
                count_query = count_query.where(EvaluationRecord.status == status)
            count_result = await session.execute(count_query)
            total = count_result.scalar() or 0

            # Paginate
            offset = (page - 1) * limit
            query = query.offset(offset).limit(limit)
            result = await session.execute(query)
            records = result.scalars().all()

            return {
                "evaluations": [self._record_to_summary(r) for r in records],
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": (total + limit - 1) // limit if limit > 0 else 0,
            }

    async def get_evaluations_by_ids(self, ids: list[str]) -> list[dict]:
        """Get multiple evaluations by their IDs (for comparison)."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(EvaluationRecord).where(EvaluationRecord.id.in_(ids))
            )
            records = result.scalars().all()
            return [self._record_to_dict(r) for r in records]

    async def find_by_hash(self, file_hash: str) -> Optional[dict]:
        """Find the most recent completed evaluation matching a file hash.

        Used for deduplication: if an identical file was already evaluated,
        the stored result can be reused instead of re-running the pipeline.
        """
        async with self._session_factory() as session:
            result = await session.execute(
                select(EvaluationRecord)
                .where(EvaluationRecord.file_hash == file_hash)
                .where(EvaluationRecord.status == "completed")
                .order_by(EvaluationRecord.created_at.desc())
                .limit(1)
            )
            record = result.scalar_one_or_none()
            if record is None:
                return None
            return self._record_to_dict(record)

    async def get_evaluations_by_batch(self, batch_id: str) -> list[dict]:
        """Get all evaluations for a batch."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(EvaluationRecord)
                .where(EvaluationRecord.batch_id == batch_id)
                .order_by(EvaluationRecord.created_at)
            )
            records = result.scalars().all()
            return [self._record_to_dict(r) for r in records]

    # ----- Update -----

    async def update_evaluation(
        self,
        evaluation_id: str,
        **kwargs,
    ) -> bool:
        """Update fields on an evaluation record."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(EvaluationRecord).where(EvaluationRecord.id == evaluation_id)
            )
            record = result.scalar_one_or_none()
            if record is None:
                return False

            for key, value in kwargs.items():
                if key in ("evaluation_report", "document_metadata") and isinstance(value, dict):
                    value = json.dumps(value)
                if isinstance(value, datetime) and value.tzinfo is not None:
                    value = value.astimezone(timezone.utc).replace(tzinfo=None)
                if hasattr(record, key):
                    setattr(record, key, value)

            await session.commit()
            return True

    # ----- Delete -----

    async def delete_evaluation(self, evaluation_id: str) -> bool:
        """Delete an evaluation record."""
        async with self._session_factory() as session:
            result = await session.execute(
                sa_delete(EvaluationRecord).where(EvaluationRecord.id == evaluation_id)
            )
            await session.commit()
            return result.rowcount > 0

    # ----- Helpers -----

    def _record_to_dict(self, record: EvaluationRecord) -> dict:
        """Convert a full record to dict with parsed JSON fields."""
        return {
            "id": record.id,
            "filename": record.filename,
            "file_storage_key": record.file_storage_key,
            "file_storage_url": record.file_storage_url,
            "file_size_bytes": record.file_size_bytes,
            "file_content_type": record.file_content_type,
            "overall_score": record.overall_score,
            "recommendation": record.recommendation,
            "evaluation_report": json.loads(record.evaluation_report) if record.evaluation_report else None,
            "document_metadata": json.loads(record.document_metadata) if record.document_metadata else None,
            "status": record.status,
            "error_message": record.error_message,
            "batch_id": record.batch_id,
            "file_hash": record.file_hash,
            "processing_stage": record.processing_stage,
            "failure_status": record.failure_status,
            "error_code": record.error_code,
            "retry_count": record.retry_count,
            "worker_id": record.worker_id,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "started_at": record.started_at.isoformat() if record.started_at else None,
            "completed_at": record.completed_at.isoformat() if record.completed_at else None,
        }

    def _record_to_summary(self, record: EvaluationRecord) -> dict:
        """Convert a record to a lightweight summary (no full report JSON)."""
        return {
            "id": record.id,
            "filename": record.filename,
            "file_storage_url": record.file_storage_url,
            "file_size_bytes": record.file_size_bytes,
            "overall_score": record.overall_score,
            "recommendation": record.recommendation,
            "status": record.status,
            "processing_stage": record.processing_stage,
            "failure_status": record.failure_status,
            "batch_id": record.batch_id,
            "created_at": record.created_at.isoformat() if record.created_at else None,
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_repo_instance: Optional[EvaluationRepository] = None


def get_repository() -> EvaluationRepository:
    """Get the repository singleton."""
    global _repo_instance
    if _repo_instance is None:
        _repo_instance = EvaluationRepository()
    return _repo_instance


def reset_repository() -> None:
    """Reset the singleton (used in tests)."""
    global _repo_instance
    _repo_instance = None
