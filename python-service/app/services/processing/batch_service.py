"""
Batch processing.

Batch *upload* is already just the ingest endpoint with several files — they share a
`batch_id` and each is processed independently, so one bad PDF in a set of twenty fails
only itself.

Batch *evaluation* is this, and it is now a submission rather than a run. The previous
version awaited every evaluation inside the HTTP handler: twenty proposals at several
minutes each, held open on one connection, and the whole thing lost if the caller
disconnected or the gateway timed out. Queueing instead means the call returns in
milliseconds and the work survives the browser, the gateway and the process.

Pacing is not this module's problem either. Jobs are drained by the worker pool, and
within an evaluation the TPM limiter admits agent calls exactly as fast as the token
budget allows.

Failures stay per-proposal. A batch of twenty in which three documents fail extraction
produces seventeen evaluations and three retryable failures, not a dead batch.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.database.job_repository import get_job_repository
from app.services.database.proposal_repository import get_proposal_repository
from app.services.database.repository import get_repository
from app.utils.logging import get_logger

logger = get_logger(__name__)

# A batch is capped at 25 files on upload, but a caller can group more under one
# batch_id, so read generously rather than assuming.
BATCH_READ_LIMIT = 200


class BatchService:
    def __init__(self) -> None:
        self.proposals = get_proposal_repository()
        self.evaluations = get_repository()
        self.jobs = get_job_repository()

    async def evaluate_batch(
        self,
        batch_id: str,
        *,
        triggered_by: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Queue an evaluation for every proposal in a batch that is ready for one.

        Skips proposals still awaiting a duplicate ruling and those the admin already
        marked duplicates — the gate is a gate, and a batch run must not drive straight
        through it.
        """
        listing = await self.proposals.list_proposals(
            batch_id=batch_id, limit=BATCH_READ_LIMIT
        )
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

        queued = []
        for proposal in ready:
            job = await self.jobs.enqueue(
                kind="evaluate",
                proposal_id=proposal["id"],
                batch_id=batch_id,
                requested_by=triggered_by,
            )
            queued.append(
                {
                    "proposal_id": proposal["id"],
                    "filename": proposal["filename"],
                    "job_id": job["id"],
                }
            )

        logger.info(
            "batch_evaluation_queued",
            batch_id=batch_id,
            total=len(proposals),
            queued=len(queued),
            awaiting_review=len(blocked),
        )

        return {
            "batch_id": batch_id,
            "total": len(proposals),
            "queued": len(queued),
            "awaiting_review": len(blocked),
            "skipped_as_duplicate": len(skipped),
            "already_evaluated": len(already),
            "results": queued,
        }

    async def get_batch(self, batch_id: str) -> dict[str, Any]:
        """Current state of a batch — what is done, what is stuck, and why."""
        listing = await self.proposals.list_proposals(
            batch_id=batch_id, limit=BATCH_READ_LIMIT
        )
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
            # Still moving: anything the pipeline has not yet parked in a terminal
            # state. Drives "7 of 12 processed" without the client having to know
            # which statuses are terminal.
            "in_progress": sum(
                1
                for p in proposals
                if p["status"]
                not in ("evaluated", "failed", "skipped", "pending_review", "queued")
            ),
            "proposals": proposals,
        }


_service: Optional[BatchService] = None


def get_batch_service() -> BatchService:
    global _service
    if _service is None:
        _service = BatchService()
    return _service
