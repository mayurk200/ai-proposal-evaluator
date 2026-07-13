"""
Proposal persistence — the core of the registry.

Every uploaded idea gets a row here immediately, before extraction and before any
LLM call, and it keeps that row whether or not it is ever evaluated. That is what
makes requirements (g) "a failed idea is managed neatly and retried, not marked
successful on upload" and "an admin can evaluate a stored idea later without
re-uploading the document" possible at all.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, inspect, select, update
from sqlalchemy.orm import selectinload

from app.config import settings
from app.services.database.models import Proposal, SimilarityMatch
from app.services.database.session import get_session_factory
from app.utils.logging import get_logger

logger = get_logger(__name__)

# How much of the document text we inline on the row. The full text lives in
# object storage. Keeping the whole thing in a Text column made every list query
# drag megabytes of OCR output across the wire for rows nobody opened.
PREVIEW_CHARS = 2000


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ProposalRepository:
    """CRUD + queries over `proposals`."""

    def __init__(self) -> None:
        self._sessions = get_session_factory()

    # ------------------------------------------------------------------
    # Create / dedup
    # ------------------------------------------------------------------

    async def find_by_hash(self, file_hash: str) -> Optional[dict]:
        """
        Exact-duplicate check. Same bytes, whatever the filename, means we have
        already done this work — return the existing row instead of paying for
        extraction and a full agent pipeline a second time.

        The eager loads are load-bearing, not decorative: `_to_dict` reads
        `row.company.name` and `row.category.slug`, and under async SQLAlchemy a
        lazy relationship touched after the query has completed raises
        MissingGreenlet. Without these, every duplicate re-upload 500s.
        """
        async with self._sessions() as session:
            result = await session.execute(
                select(Proposal)
                .options(selectinload(Proposal.company), selectinload(Proposal.category))
                .where(Proposal.file_hash == file_hash)
                .limit(1)
            )
            row = result.scalar_one_or_none()
            return self._to_dict(row) if row else None

    async def create(
        self,
        *,
        filename: str,
        file_hash: str,
        file_format: str,
        file_size_bytes: int,
        content_type: str,
        storage_key: Optional[str] = None,
        storage_url: Optional[str] = None,
        uploaded_by: Optional[str] = None,
        batch_id: Optional[str] = None,
    ) -> str:
        """Insert a proposal in `uploaded` state and return its id."""
        proposal_id = str(uuid.uuid4())

        async with self._sessions() as session:
            session.add(
                Proposal(
                    id=proposal_id,
                    filename=filename,
                    file_hash=file_hash,
                    file_format=file_format,
                    file_size_bytes=file_size_bytes,
                    content_type=content_type,
                    storage_key=storage_key,
                    storage_url=storage_url,
                    uploaded_by=uploaded_by,
                    batch_id=batch_id,
                    status="uploaded",
                )
            )
            await session.commit()

        logger.info("proposal_created", proposal_id=proposal_id, filename=filename)
        return proposal_id

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    async def update(self, proposal_id: str, **fields: Any) -> bool:
        """Patch arbitrary columns. Unknown keys are ignored, not fatal."""
        known = {k: v for k, v in fields.items() if hasattr(Proposal, k)}
        if not known:
            return False

        # Keep the inlined preview consistent whenever the text changes.
        if "extracted_text" in known and known["extracted_text"]:
            known.setdefault("text_preview", known["extracted_text"][:PREVIEW_CHARS])

        known["updated_at"] = _utcnow()

        async with self._sessions() as session:
            result = await session.execute(
                update(Proposal).where(Proposal.id == proposal_id).values(**known)
            )
            await session.commit()
            return result.rowcount > 0

    async def set_status(self, proposal_id: str, status: str) -> bool:
        return await self.update(proposal_id, status=status)

    async def mark_failed(
        self, proposal_id: str, stage: str, error: str
    ) -> bool:
        """
        Record a failure without destroying it.

        The row stays queryable, keeps the stage it died at and the reason, and
        increments its retry counter — so the dashboard can show a real failure
        queue and an operator can retry it, rather than the idea silently
        vanishing or being reported as processed.
        """
        async with self._sessions() as session:
            result = await session.execute(
                select(Proposal).where(Proposal.id == proposal_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return False

            row.status = "failed"
            row.error_stage = stage
            row.error_message = error[:4000]
            row.last_error_at = _utcnow()
            row.retry_count = (row.retry_count or 0) + 1
            row.updated_at = _utcnow()

            await session.commit()

        logger.warning(
            "proposal_failed", proposal_id=proposal_id, stage=stage, error=error[:200]
        )
        return True

    async def is_retryable(self, proposal_id: str) -> bool:
        """A failure stops being automatically retryable once it has burned its budget."""
        row = await self.get(proposal_id)
        if not row:
            return False
        return (
            row["status"] == "failed"
            and row["retry_count"] < settings.MAX_EVALUATION_RETRIES
        )

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    async def get(self, proposal_id: str, *, with_text: bool = False) -> Optional[dict]:
        async with self._sessions() as session:
            result = await session.execute(
                select(Proposal)
                .options(selectinload(Proposal.company), selectinload(Proposal.category))
                .where(Proposal.id == proposal_id)
            )
            row = result.scalar_one_or_none()
            return self._to_dict(row, with_text=with_text) if row else None

    async def list_proposals(
        self,
        *,
        page: int = 1,
        limit: int = 20,
        status: Optional[str] = None,
        review_decision: Optional[str] = None,
        is_evaluated: Optional[bool] = None,
        category_id: Optional[str] = None,
        company_id: Optional[str] = None,
        batch_id: Optional[str] = None,
        search: Optional[str] = None,
    ) -> dict:
        """Paginated, filtered listing. Never returns full extracted text."""
        filters = []
        if status:
            filters.append(Proposal.status == status)
        if review_decision:
            filters.append(Proposal.review_decision == review_decision)
        if is_evaluated is not None:
            filters.append(Proposal.is_evaluated.is_(is_evaluated))
        if category_id:
            filters.append(Proposal.category_id == category_id)
        if company_id:
            filters.append(Proposal.company_id == company_id)
        if batch_id:
            filters.append(Proposal.batch_id == batch_id)
        if search:
            pattern = f"%{search.lower()}%"
            filters.append(
                func.lower(Proposal.title).like(pattern)
                | func.lower(Proposal.filename).like(pattern)
            )

        async with self._sessions() as session:
            count_q = select(func.count()).select_from(Proposal)
            list_q = (
                select(Proposal)
                .options(selectinload(Proposal.company), selectinload(Proposal.category))
                .order_by(Proposal.created_at.desc())
            )
            for f in filters:
                count_q = count_q.where(f)
                list_q = list_q.where(f)

            total = (await session.execute(count_q)).scalar() or 0
            rows = (
                (await session.execute(list_q.offset((page - 1) * limit).limit(limit)))
                .scalars()
                .all()
            )

            return {
                "proposals": [self._to_dict(r) for r in rows],
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": (total + limit - 1) // limit if limit else 0,
            }

    async def get_full_text(self, proposal_id: str) -> Optional[str]:
        """
        Fetch the stored text for re-evaluation.

        This is what lets an admin evaluate an idea that was ingested but never
        evaluated, straight from the database, with no re-upload of the document.
        """
        async with self._sessions() as session:
            result = await session.execute(
                select(Proposal.extracted_text).where(Proposal.id == proposal_id)
            )
            return result.scalar_one_or_none()

    # ------------------------------------------------------------------
    # Similarity gate
    # ------------------------------------------------------------------

    async def find_similar(
        self,
        *,
        embedding: list[float],
        exclude_id: str,
        limit: Optional[int] = None,
        threshold: Optional[float] = None,
    ) -> list[dict]:
        """
        Nearest neighbours by cosine distance over the HNSW index.

        pgvector's `<=>` is cosine *distance*, so similarity is 1 - distance. We
        filter in SQL rather than in Python so the index actually gets used and
        this stays sub-linear as the archive grows year over year.
        """
        limit = limit or settings.SIMILARITY_TOP_K
        threshold = settings.SIMILARITY_THRESHOLD if threshold is None else threshold
        max_distance = 1.0 - threshold

        async with self._sessions() as session:
            distance = Proposal.embedding.cosine_distance(embedding).label("distance")
            result = await session.execute(
                select(Proposal, distance)
                .options(selectinload(Proposal.company), selectinload(Proposal.category))
                .where(
                    Proposal.id != exclude_id,
                    Proposal.embedding.is_not(None),
                    distance <= max_distance,
                )
                .order_by(distance)
                .limit(limit)
            )

            matches = []
            for row, dist in result.all():
                payload = self._to_dict(row)
                payload["similarity"] = round(1.0 - float(dist), 4)
                matches.append(payload)
            return matches

    async def record_similarity_matches(
        self, proposal_id: str, matches: list[dict]
    ) -> list[str]:
        """Persist the candidates so an admin can act on them later, not just now."""
        if not matches:
            return []

        ids = []
        async with self._sessions() as session:
            for match in matches:
                match_id = str(uuid.uuid4())
                session.add(
                    SimilarityMatch(
                        id=match_id,
                        proposal_id=proposal_id,
                        matched_proposal_id=match["id"],
                        similarity=match.get("similarity", 0.0),
                        match_reasons=match.get("match_reasons"),
                        status="pending",
                    )
                )
                ids.append(match_id)
            await session.commit()

        logger.info(
            "similarity_matches_recorded", proposal_id=proposal_id, count=len(ids)
        )
        return ids

    async def get_similarity_matches(self, proposal_id: str) -> list[dict]:
        async with self._sessions() as session:
            result = await session.execute(
                select(SimilarityMatch)
                .where(SimilarityMatch.proposal_id == proposal_id)
                .order_by(SimilarityMatch.similarity.desc())
            )
            rows = result.scalars().all()

            out = []
            for row in rows:
                other = await self.get(row.matched_proposal_id)
                out.append(
                    {
                        "id": row.id,
                        "similarity": row.similarity,
                        "status": row.status,
                        "match_reasons": row.match_reasons,
                        "reviewer_note": row.reviewer_note,
                        "matched_proposal": other,
                    }
                )
            return out

    async def resolve_similarity(
        self,
        proposal_id: str,
        *,
        status: str,
        reviewed_by: Optional[str],
        note: Optional[str] = None,
    ) -> int:
        """Close out every pending match on a proposal once the admin has ruled."""
        async with self._sessions() as session:
            result = await session.execute(
                update(SimilarityMatch)
                .where(
                    SimilarityMatch.proposal_id == proposal_id,
                    SimilarityMatch.status == "pending",
                )
                .values(
                    status=status,
                    reviewed_by=reviewed_by,
                    reviewed_at=_utcnow(),
                    reviewer_note=note,
                )
            )
            await session.commit()
            return result.rowcount

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    async def delete(self, proposal_id: str) -> bool:
        """
        Remove a proposal and everything hanging off it.

        Children go first — evaluations, decisions and similarity matches all carry
        a foreign key to this row, and Postgres will (rightly) refuse to orphan
        them. Similarity matches are deleted from *both* sides: this proposal may
        be the match target of some other proposal's pending review.
        """
        from app.services.database.models import Decision, Evaluation

        async with self._sessions() as session:
            await session.execute(
                sa_delete(SimilarityMatch).where(
                    (SimilarityMatch.proposal_id == proposal_id)
                    | (SimilarityMatch.matched_proposal_id == proposal_id)
                )
            )
            await session.execute(
                sa_delete(Decision).where(Decision.proposal_id == proposal_id)
            )
            await session.execute(
                sa_delete(Evaluation).where(Evaluation.proposal_id == proposal_id)
            )
            result = await session.execute(
                sa_delete(Proposal).where(Proposal.id == proposal_id)
            )
            await session.commit()

        logger.info("proposal_deleted", proposal_id=proposal_id)
        return result.rowcount > 0

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def _to_dict(self, row: Proposal, *, with_text: bool = False) -> dict:
        # `company` and `category` are lazy relationships. If the caller's query
        # forgot to eager-load them, touching them here would raise MissingGreenlet
        # (async SQLAlchemy cannot lazy-load outside the greenlet context) and take
        # down an endpoint that was otherwise fine. Read them out of the already-
        # loaded instance state instead, so a missing eager-load degrades to a null
        # name rather than a 500. Callers that need the names still eager-load them.
        loaded = inspect(row).unloaded
        company = None if "company" in loaded else row.company
        category = None if "category" in loaded else row.category

        payload = {
            "id": row.id,
            "filename": row.filename,
            "file_format": row.file_format,
            "file_size_bytes": row.file_size_bytes,
            "content_type": row.content_type,
            "file_hash": row.file_hash,
            "storage_key": row.storage_key,
            "storage_url": row.storage_url,
            "title": row.title,
            "theme": row.theme,
            "problem_statement": row.problem_statement,
            "solution_summary": row.solution_summary,
            "idea_metadata": row.idea_metadata,
            "company_id": row.company_id,
            "company_name": company.name if company else None,
            "category_id": row.category_id,
            "category_slug": category.slug if category else None,
            "category_label": category.label if category else None,
            "secondary_categories": row.secondary_categories,
            "status": row.status,
            "is_evaluated": row.is_evaluated,
            "review_decision": row.review_decision,
            "total_pages": row.total_pages,
            "total_words": row.total_words,
            "total_tables": row.total_tables,
            "total_images": row.total_images,
            "has_scanned_content": row.has_scanned_content,
            "sections": list(row.sections.keys()) if row.sections else [],
            "error_message": row.error_message,
            "error_stage": row.error_stage,
            "retry_count": row.retry_count,
            "batch_id": row.batch_id,
            "text_preview": row.text_preview,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        if with_text:
            payload["extracted_text"] = row.extracted_text
            payload["sections_detail"] = row.sections
        return payload


_repo: Optional[ProposalRepository] = None


def get_proposal_repository() -> ProposalRepository:
    global _repo
    if _repo is None:
        _repo = ProposalRepository()
    return _repo


def reset_proposal_repository() -> None:
    """Used by tests."""
    global _repo
    _repo = None
