"""
Evaluation as a persisted, retryable operation.

The old `/evaluate` was a single synchronous HTTP call that ran the whole pipeline and
returned the report. If anything died partway — the Node proxy timing out at five
minutes, a process restart, a Groq outage on agent five of seven — the work simply
vanished. Nothing recorded that an evaluation had been attempted, so there was nothing
to see and nothing to retry, and the proposal sat looking exactly as it had before.

Here, the evaluation row is opened BEFORE the agents run and closed after, so an
evaluation is always in one of three honest states: `processing`, `completed`, or
`failed` with the reason. Requirement (g): "if an idea fails to evaluate it should be
managed neatly and should be retried, and not only marked successful after upload".

Re-evaluation never re-reads the document. Sections were persisted at ingestion, so
evaluating a stored idea months later costs the agent calls and nothing else — which is
what makes "the admin can evaluate an un-evaluated idea from the database without
re-uploading" cheap rather than a full re-ingest.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.agents.orchestrator import orchestrator
from app.config import settings
from app.services.database.proposal_repository import get_proposal_repository
from app.services.database.registry_repository import get_registry_repository
from app.services.database.repository import get_repository
from app.services.processing.sectioniser import (
    SCOREABLE_SECTION_KEYS,
    sections_from_json,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EvaluationError(RuntimeError):
    """Raised when an evaluation cannot even be started."""


class EvaluationService:
    def __init__(self) -> None:
        self.proposals = get_proposal_repository()
        self.evaluations = get_repository()
        self.registry = get_registry_repository()

    async def evaluate(
        self,
        proposal_id: str,
        *,
        triggered_by: Optional[str] = None,
        force: bool = False,
        batch_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Run the agent pipeline over a stored proposal.

        Idempotent unless `force`: a proposal that already has a completed evaluation
        returns it rather than paying for the whole pipeline again. Repeat clicks are
        free, which matters because an evaluation is the single most expensive thing
        this system does.
        """
        proposal = await self.proposals.get(proposal_id, with_text=True)
        if not proposal:
            raise EvaluationError(f"Proposal {proposal_id} not found")

        # The duplicate gate is a gate: an idea awaiting an admin's ruling, or one the
        # admin ruled a duplicate, must not quietly get evaluated anyway.
        if proposal["review_decision"] == "pending":
            raise EvaluationError(
                "This proposal is awaiting a duplicate review. An admin must decide "
                "whether to evaluate it first."
            )
        if proposal["review_decision"] == "skipped_duplicate":
            raise EvaluationError(
                "This proposal was marked a duplicate and skipped. Re-open the review "
                "to evaluate it."
            )

        if not force:
            existing = await self.evaluations.get_latest_for_proposal(proposal_id)
            if existing:
                logger.info(
                    "evaluation_reused", proposal_id=proposal_id, evaluation_id=existing["id"]
                )
                return {**existing, "reused": True}

        sections = sections_from_json(proposal.get("sections_detail"))
        scoreable = {
            key: text for key, text in sections.items() if key in SCOREABLE_SECTION_KEYS
        }

        if not scoreable:
            message = (
                "This proposal has no sections that can be evaluated. It may have failed "
                "extraction — re-run processing before evaluating."
            )
            await self.proposals.mark_failed(proposal_id, "evaluation", message)
            raise EvaluationError(message)

        # Open the row first. An evaluation that dies mid-pipeline now leaves a
        # `processing` row that the retry queue can find, instead of leaving nothing.
        evaluation_id = await self.evaluations.create_pending(
            proposal_id=proposal_id, triggered_by=triggered_by, batch_id=batch_id
        )
        await self.proposals.set_status(proposal_id, "evaluating")

        try:
            response = await orchestrator.evaluate(
                sections=scoreable, proposal_id=proposal_id
            )
        except Exception as exc:
            logger.error("evaluation_failed", proposal_id=proposal_id, error=str(exc))
            await self.evaluations.fail(evaluation_id, str(exc))
            await self.proposals.mark_failed(proposal_id, "evaluation", str(exc))
            raise EvaluationError(f"Evaluation failed: {exc}") from exc

        final = response.evaluation

        await self.evaluations.complete(
            evaluation_id,
            overall_score=final.overall_score,
            recommendation=final.recommendation,
            report=response.model_dump(mode="json"),
            parameter_scores={
                key: param.parameter_score
                for key, param in final.parameter_breakdown.items()
            },
            swot=final.swot_analysis.model_dump(mode="json"),
            risk_level=final.risk_level,
            total_tokens=response.total_tokens,
            total_duration_ms=int(response.processing_time_seconds * 1000),
            model_used=response.model_used,
        )

        # The verdict is copied onto the proposal row as well as living in
        # `evaluations`. A listing of a thousand proposals sorted by score must
        # not join the report table and pull JSONB for every row it displays.
        await self.proposals.update(
            proposal_id,
            status="evaluated",
            is_evaluated=True,
            latest_score=final.overall_score,
            latest_recommendation=final.recommendation,
            latest_evaluation_id=evaluation_id,
            evaluated_at=_utcnow(),
            error_message=None,
            error_stage=None,
        )

        await self.registry.audit(
            action="proposal_evaluated",
            entity_type="proposal",
            entity_id=proposal_id,
            actor_id=triggered_by,
            payload={
                "evaluation_id": evaluation_id,
                "score": final.overall_score,
                "recommendation": final.recommendation,
                "tokens": response.total_tokens,
            },
        )

        logger.info(
            "evaluation_persisted",
            proposal_id=proposal_id,
            evaluation_id=evaluation_id,
            score=final.overall_score,
            tokens=response.total_tokens,
        )

        return {
            "id": evaluation_id,
            "proposal_id": proposal_id,
            "overall_score": final.overall_score,
            "recommendation": final.recommendation,
            "risk_level": final.risk_level,
            "evidence_coverage": final.evidence_coverage,
            "unevidenced_parameters": final.unevidenced_parameters,
            "total_tokens": response.total_tokens,
            "report": response.model_dump(mode="json"),
            "status": "completed",
            "reused": False,
        }

    async def retry(self, proposal_id: str, *, triggered_by: Optional[str] = None) -> dict:
        """
        Retry a failed evaluation.

        Budget-limited: a proposal that has burned its retries needs a human to look at
        the document rather than a fourth automatic attempt at the same failure.
        """
        proposal = await self.proposals.get(proposal_id)
        if not proposal:
            raise EvaluationError(f"Proposal {proposal_id} not found")

        if proposal["retry_count"] >= settings.MAX_EVALUATION_RETRIES:
            raise EvaluationError(
                f"This proposal has already failed {proposal['retry_count']} times. "
                "It needs to be looked at rather than retried again."
            )

        return await self.evaluate(proposal_id, triggered_by=triggered_by, force=True)


_service: Optional[EvaluationService] = None


def get_evaluation_service() -> EvaluationService:
    global _service
    if _service is None:
        _service = EvaluationService()
    return _service
