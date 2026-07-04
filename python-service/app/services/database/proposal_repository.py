"""
Async repository for ingested proposals (the `proposals` table).

Handles persistence for Step 1 of the pipeline: the uploaded original file,
its extracted text, and the storage addresses recorded in the JSON manifest.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import settings
from app.services.database.models import Base, ProposalRecord
from app.utils.logging import get_logger

logger = get_logger(__name__)


def utc_now_naive() -> datetime:
    """Return UTC as a naive datetime for the timestamp columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ProposalRepository:
    """CRUD operations for ingested proposal records."""

    def __init__(self, database_url: Optional[str] = None):
        self._url = database_url or settings.DATABASE_URL
        self._engine = create_async_engine(self._url, echo=False, pool_pre_ping=True)
        self._session_factory = async_sessionmaker(self._engine, expire_on_commit=False)

    async def init_tables(self) -> None:
        """Create tables if they don't exist (creates all Base tables)."""
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("proposal_tables_initialized")

    async def close(self) -> None:
        """Dispose of the engine connection pool."""
        await self._engine.dispose()

    # ----- Create -----

    async def create_proposal(
        self,
        proposal_id: str,
        filename: str,
        document_format: str = "",
        file_content_type: str = "application/octet-stream",
        file_size_bytes: int = 0,
        file_hash: Optional[str] = None,
        original_key: str = "",
        original_url: str = "",
        extracted_key: str = "",
        extracted_url: str = "",
        manifest_key: str = "",
        manifest_url: str = "",
        extracted_text: Optional[str] = None,
        char_count: int = 0,
        total_pages: int = 0,
        total_words: int = 0,
        total_images: int = 0,
        total_tables: int = 0,
        has_scanned_content: bool = False,
        detected_sections: Optional[list] = None,
        status: str = "text_extracted",
        error_message: Optional[str] = None,
        extracted_at: Optional[datetime] = None,
    ) -> str:
        """Persist a proposal record and return its ID."""
        record = ProposalRecord(
            id=proposal_id,
            filename=filename,
            document_format=document_format,
            file_content_type=file_content_type,
            file_size_bytes=file_size_bytes,
            file_hash=file_hash,
            original_key=original_key,
            original_url=original_url,
            extracted_key=extracted_key,
            extracted_url=extracted_url,
            manifest_key=manifest_key,
            manifest_url=manifest_url,
            extracted_text=extracted_text,
            char_count=char_count,
            total_pages=total_pages,
            total_words=total_words,
            total_images=total_images,
            total_tables=total_tables,
            has_scanned_content=has_scanned_content,
            detected_sections=json.dumps(detected_sections) if detected_sections else None,
            status=status,
            error_message=error_message,
            created_at=utc_now_naive(),
            extracted_at=extracted_at,
            updated_at=utc_now_naive(),
        )

        async with self._session_factory() as session:
            session.add(record)
            await session.commit()

        logger.info("proposal_saved", id=proposal_id, filename=filename, status=status)
        return proposal_id

    # ----- Read -----

    async def get_proposal(self, proposal_id: str) -> Optional[dict]:
        """Get a single proposal record by ID."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(ProposalRecord).where(ProposalRecord.id == proposal_id)
            )
            record = result.scalar_one_or_none()
            if record is None:
                return None
            return self._record_to_dict(record)

    async def find_by_hash(self, file_hash: str) -> Optional[dict]:
        """Find the most recent proposal matching a file hash (deduplication)."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(ProposalRecord)
                .where(ProposalRecord.file_hash == file_hash)
                .order_by(ProposalRecord.created_at.desc())
                .limit(1)
            )
            record = result.scalar_one_or_none()
            if record is None:
                return None
            return self._record_to_dict(record)

    async def list_proposals(self, page: int = 1, limit: int = 20) -> dict:
        """List proposals with pagination (summary view)."""
        from sqlalchemy import func

        async with self._session_factory() as session:
            count_result = await session.execute(
                select(func.count()).select_from(ProposalRecord)
            )
            total = count_result.scalar() or 0

            offset = (page - 1) * limit
            result = await session.execute(
                select(ProposalRecord)
                .order_by(ProposalRecord.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
            records = result.scalars().all()

            return {
                "proposals": [self._record_to_summary(r) for r in records],
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": (total + limit - 1) // limit if limit > 0 else 0,
            }

    # ----- Update -----

    async def update_proposal(self, proposal_id: str, **kwargs) -> bool:
        """Update fields on a proposal record."""
        async with self._session_factory() as session:
            result = await session.execute(
                select(ProposalRecord).where(ProposalRecord.id == proposal_id)
            )
            record = result.scalar_one_or_none()
            if record is None:
                return False

            for key, value in kwargs.items():
                if key == "detected_sections" and isinstance(value, list):
                    value = json.dumps(value)
                if isinstance(value, datetime) and value.tzinfo is not None:
                    value = value.astimezone(timezone.utc).replace(tzinfo=None)
                if hasattr(record, key):
                    setattr(record, key, value)

            await session.commit()
            return True

    # ----- Delete -----

    async def delete_proposal(self, proposal_id: str) -> bool:
        """Delete a proposal record."""
        async with self._session_factory() as session:
            result = await session.execute(
                sa_delete(ProposalRecord).where(ProposalRecord.id == proposal_id)
            )
            await session.commit()
            return result.rowcount > 0

    # ----- Helpers -----

    def _record_to_dict(self, record: ProposalRecord) -> dict:
        """Convert a full record to dict (includes extracted text)."""
        return {
            "id": record.id,
            "filename": record.filename,
            "document_format": record.document_format,
            "file_content_type": record.file_content_type,
            "file_size_bytes": record.file_size_bytes,
            "file_hash": record.file_hash,
            "original_key": record.original_key,
            "original_url": record.original_url,
            "extracted_key": record.extracted_key,
            "extracted_url": record.extracted_url,
            "manifest_key": record.manifest_key,
            "manifest_url": record.manifest_url,
            "extracted_text": record.extracted_text,
            "char_count": record.char_count,
            "total_pages": record.total_pages,
            "total_words": record.total_words,
            "total_images": record.total_images,
            "total_tables": record.total_tables,
            "has_scanned_content": record.has_scanned_content,
            "detected_sections": json.loads(record.detected_sections) if record.detected_sections else [],
            "status": record.status,
            "error_message": record.error_message,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "extracted_at": record.extracted_at.isoformat() if record.extracted_at else None,
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        }

    def _record_to_summary(self, record: ProposalRecord) -> dict:
        """Convert a record to a lightweight summary (no extracted text)."""
        return {
            "id": record.id,
            "filename": record.filename,
            "document_format": record.document_format,
            "file_size_bytes": record.file_size_bytes,
            "file_hash": record.file_hash,
            "manifest_url": record.manifest_url,
            "total_words": record.total_words,
            "status": record.status,
            "created_at": record.created_at.isoformat() if record.created_at else None,
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_proposal_repo_instance: Optional[ProposalRepository] = None


def get_proposal_repository() -> ProposalRepository:
    """Get the proposal repository singleton."""
    global _proposal_repo_instance
    if _proposal_repo_instance is None:
        _proposal_repo_instance = ProposalRepository()
    return _proposal_repo_instance


def reset_proposal_repository() -> None:
    """Reset the singleton (used in tests)."""
    global _proposal_repo_instance
    _proposal_repo_instance = None
