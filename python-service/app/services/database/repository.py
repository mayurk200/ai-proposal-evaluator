"""
Evaluation persistence.

An evaluation is a run, not a property of a proposal — a proposal can be
evaluated more than once (a retry after failure, a forced re-run after the rubric
changes) and we keep every run. The proposal row carries the *current* verdict;
this table carries the history.

Report bodies are JSONB rather than JSON-as-text. The previous schema stored them
as `Text` and `json.dumps`'d on the way in, which meant the database could not see
inside them: "show me every proposal whose financial sub-score is below 4" had to
be done by pulling every report into Python and parsing it.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func, select, update, delete as sa_delete

from app.services.database.models import Evaluation
from app.services.database.session import get_session_factory
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EvaluationRepository:
    """CRUD over `evaluations`."""

    def __init__(self) -> None:
        self._sessions = get_session_factory()

    # ------------------------------------------------------------------
    # Create / update
    # ------------------------------------------------------------------

    async def create_pending(
        self,
        *,
        proposal_id: str,
        batch_id: Optional[str] = None,
        triggered_by: Optional[str] = None,
    ) -> str:
        """
        Open an evaluation row *before* the agents run.

        An in-flight evaluation is therefore visible in the database, so a crash
        mid-pipeline leaves a `processing` row that can be found and retried —
        rather than nothing at all, which is what the old fire-and-forget
        `/evaluate` left behind.
        """
        evaluation_id = str(uuid.uuid4())

        async with self._sessions() as session:
            session.add(
                Evaluation(
                    id=evaluation_id,
                    proposal_id=proposal_id,
                    batch_id=batch_id,
                    triggered_by=triggered_by,
                    status="processing",
                )
            )
            await session.commit()

        return evaluation_id

    async def complete(
        self,
        evaluation_id: str,
        *,
        overall_score: float,
        recommendation: str,
        report: dict,
        parameter_scores: Optional[dict] = None,
        swot: Optional[dict] = None,
        risk_level: Optional[str] = None,
        total_tokens: int = 0,
        total_duration_ms: int = 0,
        model_used: Optional[str] = None,
    ) -> bool:
        async with self._sessions() as session:
            result = await session.execute(
                update(Evaluation)
                .where(Evaluation.id == evaluation_id)
                .values(
                    status="completed",
                    overall_score=overall_score,
                    recommendation=recommendation,
                    report=report,
                    parameter_scores=parameter_scores,
                    swot=swot,
                    risk_level=risk_level,
                    total_tokens=total_tokens,
                    total_duration_ms=total_duration_ms,
                    model_used=model_used,
                    completed_at=_utcnow(),
                )
            )
            await session.commit()
            return result.rowcount > 0

    async def fail(self, evaluation_id: str, error: str) -> bool:
        async with self._sessions() as session:
            result = await session.execute(
                update(Evaluation)
                .where(Evaluation.id == evaluation_id)
                .values(
                    status="failed",
                    error_message=error[:4000],
                    completed_at=_utcnow(),
                )
            )
            await session.commit()
            return result.rowcount > 0

    async def update(self, evaluation_id: str, **fields: Any) -> bool:
        known = {k: v for k, v in fields.items() if hasattr(Evaluation, k)}
        if not known:
            return False
        async with self._sessions() as session:
            result = await session.execute(
                update(Evaluation).where(Evaluation.id == evaluation_id).values(**known)
            )
            await session.commit()
            return result.rowcount > 0

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    async def get(self, evaluation_id: str) -> Optional[dict]:
        async with self._sessions() as session:
            row = (
                await session.execute(
                    select(Evaluation).where(Evaluation.id == evaluation_id)
                )
            ).scalar_one_or_none()
            return self._to_dict(row) if row else None

    async def get_latest_for_proposal(self, proposal_id: str) -> Optional[dict]:
        """The current verdict on an idea."""
        async with self._sessions() as session:
            row = (
                await session.execute(
                    select(Evaluation)
                    .where(
                        Evaluation.proposal_id == proposal_id,
                        Evaluation.status == "completed",
                    )
                    .order_by(Evaluation.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            return self._to_dict(row) if row else None

    async def list_for_proposal(self, proposal_id: str) -> list[dict]:
        """Full run history, newest first."""
        async with self._sessions() as session:
            rows = (
                (
                    await session.execute(
                        select(Evaluation)
                        .where(Evaluation.proposal_id == proposal_id)
                        .order_by(Evaluation.created_at.desc())
                    )
                )
                .scalars()
                .all()
            )
            return [self._to_summary(r) for r in rows]

    async def list_evaluations(
        self,
        *,
        page: int = 1,
        limit: int = 20,
        status: Optional[str] = None,
    ) -> dict:
        async with self._sessions() as session:
            count_q = select(func.count()).select_from(Evaluation)
            list_q = select(Evaluation).order_by(Evaluation.created_at.desc())

            if status:
                count_q = count_q.where(Evaluation.status == status)
                list_q = list_q.where(Evaluation.status == status)

            total = (await session.execute(count_q)).scalar() or 0
            rows = (
                (await session.execute(list_q.offset((page - 1) * limit).limit(limit)))
                .scalars()
                .all()
            )

            return {
                "evaluations": [self._to_summary(r) for r in rows],
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": (total + limit - 1) // limit if limit else 0,
            }

    async def get_by_ids(self, ids: list[str]) -> list[dict]:
        """For the compare view."""
        async with self._sessions() as session:
            rows = (
                (await session.execute(select(Evaluation).where(Evaluation.id.in_(ids))))
                .scalars()
                .all()
            )
            return [self._to_dict(r) for r in rows]

    async def get_by_batch(self, batch_id: str) -> list[dict]:
        async with self._sessions() as session:
            rows = (
                (
                    await session.execute(
                        select(Evaluation)
                        .where(Evaluation.batch_id == batch_id)
                        .order_by(Evaluation.created_at)
                    )
                )
                .scalars()
                .all()
            )
            return [self._to_summary(r) for r in rows]

    async def find_stale_processing(self, older_than_minutes: int = 30) -> list[dict]:
        """
        Evaluations stuck in `processing` — i.e. the process died mid-run.

        Without this they would sit as `processing` forever and the idea would
        look like it was being worked on. The retry queue picks these up.
        """
        cutoff = _utcnow().timestamp() - older_than_minutes * 60
        cutoff_dt = datetime.fromtimestamp(cutoff, tz=timezone.utc).replace(tzinfo=None)

        async with self._sessions() as session:
            rows = (
                (
                    await session.execute(
                        select(Evaluation).where(
                            Evaluation.status == "processing",
                            Evaluation.created_at < cutoff_dt,
                        )
                    )
                )
                .scalars()
                .all()
            )
            return [self._to_summary(r) for r in rows]

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    async def delete(self, evaluation_id: str) -> bool:
        async with self._sessions() as session:
            result = await session.execute(
                sa_delete(Evaluation).where(Evaluation.id == evaluation_id)
            )
            await session.commit()
            return result.rowcount > 0

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def _to_dict(self, row: Evaluation) -> dict:
        return {
            **self._to_summary(row),
            # JSONB comes back as a dict already — no json.loads round-trip.
            "report": row.report,
            "swot": row.swot,
        }

    def _to_summary(self, row: Evaluation) -> dict:
        return {
            "id": row.id,
            "proposal_id": row.proposal_id,
            "overall_score": row.overall_score,
            "recommendation": row.recommendation,
            "risk_level": row.risk_level,
            "parameter_scores": row.parameter_scores,
            "status": row.status,
            "error_message": row.error_message,
            "total_tokens": row.total_tokens,
            "total_duration_ms": row.total_duration_ms,
            "model_used": row.model_used,
            "batch_id": row.batch_id,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        }


_repo: Optional[EvaluationRepository] = None


def get_repository() -> EvaluationRepository:
    global _repo
    if _repo is None:
        _repo = EvaluationRepository()
    return _repo


def reset_repository() -> None:
    """Used by tests."""
    global _repo
    _repo = None
