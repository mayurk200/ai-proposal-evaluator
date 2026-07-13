"""
Batch processing.

Batch *upload* is already just the ingest endpoint with several files — they share a
`batch_id` and each is processed independently, so one bad PDF in a set of twenty fails
only itself.

Batch *evaluation* is this. The old implementation ran files strictly one after another
with a hardcoded `await asyncio.sleep(2)` between them, on the theory that spacing would
keep Groq happy. It was a guess: too slow when the budget had room, and still not enough
when it did not — the sleep is unrelated to what the rate limit actually measures, which
is tokens, not files.

Now the TPM limiter is the pacing mechanism. Batch evaluation simply submits the work and
the limiter admits it exactly as fast as the token budget allows — no faster, and no
slower. Concurrency is bounded only to keep the queue from being unboundedly deep.

Failures are per-proposal. A batch of twenty in which three documents fail extraction
produces seventeen evaluations and three retryable failures, not a dead batch.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from app.services.database.proposal_repository import get_proposal_repository
from app.services.database.repository import get_repository
from app.services.processing.evaluation_service import (
    EvaluationError,
    get_evaluation_service,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)

# How many evaluations to have in flight. Each one internally runs its seven agents
# under the shared TPM budget, so this is about queue depth, not throughput — the token
# budget is what actually governs the rate.
MAX_CONCURRENT_EVALUATIONS = 2


class BatchService:
    def __init__(self) -> None:
        self.proposals = get_proposal_repository()
        self.evaluations = get_repository()

    async def evaluate_batch(
        self,
        batch_id: str,
        *,
        triggered_by: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Evaluate every proposal in a batch that is ready for it.

        Skips proposals still awaiting a duplicate ruling and those the admin already
        marked duplicates — the gate is a gate, and a batch run must not drive straight
        through it.
        """
        listing = await self.proposals.list_proposals(batch_id=batch_id, limit=100)
        proposals = listing["proposals"]

        if not proposals:
            raise ValueError(f"No proposals found for batch {batch_id}")

        ready = [
            p
            for p in proposals
            if p["review_decision"] == "approved_for_eval" and not p["is_evaluated"]
        ]
        blocked = [p for p in proposals if p["review_decision"] == "pending"]
        skipped = [p for p in proposals if p["review_decision"] == "skipped_duplicate"]
        already = [p for p in proposals if p["is_evaluated"]]

        logger.info(
            "batch_evaluation_started",
            batch_id=batch_id,
            total=len(proposals),
            ready=len(ready),
            awaiting_review=len(blocked),
        )

        semaphore = asyncio.Semaphore(MAX_CONCURRENT_EVALUATIONS)
        service = get_evaluation_service()

        async def run(proposal: dict) -> dict:
            async with semaphore:
                try:
                    result = await service.evaluate(
                        proposal["id"], triggered_by=triggered_by, batch_id=batch_id
                    )
                    return {
                        "proposal_id": proposal["id"],
                        "filename": proposal["filename"],
                        "status": "completed",
                        "overall_score": result["overall_score"],
                        "recommendation": result["recommendation"],
                    }
                except (EvaluationError, Exception) as exc:
                    # The proposal row already carries the failure and its retry count;
                    # the batch keeps going.
                    logger.warning(
                        "batch_item_failed",
                        batch_id=batch_id,
                        proposal_id=proposal["id"],
                        error=str(exc),
                    )
                    return {
                        "proposal_id": proposal["id"],
                        "filename": proposal["filename"],
                        "status": "failed",
                        "error": str(exc),
                    }

        results = await asyncio.gather(*(run(p) for p in ready)) if ready else []

        completed = sum(1 for r in results if r["status"] == "completed")
        failed = sum(1 for r in results if r["status"] == "failed")

        logger.info(
            "batch_evaluation_completed",
            batch_id=batch_id,
            completed=completed,
            failed=failed,
        )

        return {
            "batch_id": batch_id,
            "total": len(proposals),
            "evaluated": completed,
            "failed": failed,
            "awaiting_review": len(blocked),
            "skipped_as_duplicate": len(skipped),
            "already_evaluated": len(already),
            "results": results,
        }

    async def get_batch(self, batch_id: str) -> dict[str, Any]:
        """Current state of a batch — what is done, what is stuck, and why."""
        listing = await self.proposals.list_proposals(batch_id=batch_id, limit=100)
        proposals = listing["proposals"]

        if not proposals:
            raise ValueError(f"No proposals found for batch {batch_id}")

        by_status: dict[str, int] = {}
        for proposal in proposals:
            by_status[proposal["status"]] = by_status.get(proposal["status"], 0) + 1

        return {
            "batch_id": batch_id,
            "total": len(proposals),
            "by_status": by_status,
            "evaluated": sum(1 for p in proposals if p["is_evaluated"]),
            "awaiting_review": sum(
                1 for p in proposals if p["review_decision"] == "pending"
            ),
            "failed": sum(1 for p in proposals if p["status"] == "failed"),
            "proposals": proposals,
        }


_service: Optional[BatchService] = None


def get_batch_service() -> BatchService:
    global _service
    if _service is None:
        _service = BatchService()
    return _service
