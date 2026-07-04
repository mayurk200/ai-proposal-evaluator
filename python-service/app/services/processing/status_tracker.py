"""
Processing status tracker.

Provides a lightweight, in-memory tracker for a single document's journey
through the processing pipeline: stage transitions, per-stage timing, retry
counting, and error recording. State can optionally be persisted to the
database via an injected async callback so the tracker stays decoupled from
any specific repository implementation.
"""

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional

from app.models.enums import ProcessingFailureStatus, ProcessingStatus
from app.utils.logging import get_logger

logger = get_logger(__name__)


# An async persistence hook: receives the evaluation id and a dict of fields to
# persist (e.g. {"processing_stage": "chunking", "retry_count": 1}).
PersistCallback = Callable[[str, dict], Awaitable[None]]


@dataclass
class StageTiming:
    """Timing information for a single processing stage."""
    stage: str
    started_at: float
    ended_at: Optional[float] = None

    @property
    def duration_seconds(self) -> Optional[float]:
        if self.ended_at is None:
            return None
        return round(self.ended_at - self.started_at, 4)


@dataclass
class ProcessingTracker:
    """Tracks the processing lifecycle of one evaluation.

    Args:
        evaluation_id: ID of the evaluation record being processed.
        worker_id: Optional identifier of the worker/process handling the job.
        persist: Optional async callback used to persist status changes.
    """

    evaluation_id: str
    worker_id: Optional[str] = None
    persist: Optional[PersistCallback] = None

    current_stage: Optional[str] = None
    retry_count: int = 0
    failure_status: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    started_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )
    _stages: list[StageTiming] = field(default_factory=list)
    _clock: Callable[[], float] = field(default=time.monotonic, repr=False)

    # ----- Stage transitions -----

    async def start_stage(self, stage: ProcessingStatus | str) -> None:
        """Mark the beginning of a processing stage."""
        stage_value = stage.value if isinstance(stage, ProcessingStatus) else str(stage)

        # Close out any stage still open.
        self._close_open_stage()

        self.current_stage = stage_value
        self._stages.append(StageTiming(stage=stage_value, started_at=self._clock()))
        logger.info(
            "stage_started",
            evaluation_id=self.evaluation_id,
            stage=stage_value,
            worker_id=self.worker_id,
        )
        await self._persist({"processing_stage": stage_value, "status": stage_value})

    async def complete(self) -> None:
        """Mark the whole run as completed."""
        self._close_open_stage()
        self.current_stage = ProcessingStatus.COMPLETED.value
        logger.info(
            "processing_completed",
            evaluation_id=self.evaluation_id,
            total_seconds=self.total_seconds,
        )
        await self._persist(
            {
                "processing_stage": ProcessingStatus.COMPLETED.value,
                "status": ProcessingStatus.COMPLETED.value,
            }
        )

    # ----- Retry / error handling -----

    def record_retry(self) -> int:
        """Increment and return the retry counter for the current stage."""
        self.retry_count += 1
        logger.warning(
            "processing_retry",
            evaluation_id=self.evaluation_id,
            stage=self.current_stage,
            retry_count=self.retry_count,
        )
        return self.retry_count

    async def record_failure(
        self,
        failure_status: ProcessingFailureStatus | str,
        error_message: Optional[str] = None,
        error_code: Optional[str] = None,
    ) -> None:
        """Record a terminal failure for the current run."""
        self._close_open_stage()
        self.failure_status = (
            failure_status.value
            if isinstance(failure_status, ProcessingFailureStatus)
            else str(failure_status)
        )
        self.error_message = error_message
        self.error_code = error_code
        logger.error(
            "processing_failed",
            evaluation_id=self.evaluation_id,
            stage=self.current_stage,
            failure_status=self.failure_status,
            error_code=error_code,
            error_message=error_message,
        )
        await self._persist(
            {
                "status": ProcessingStatus.FAILED.value,
                "failure_status": self.failure_status,
                "error_message": error_message,
                "error_code": error_code,
                "retry_count": self.retry_count,
            }
        )

    # ----- Introspection -----

    @property
    def total_seconds(self) -> float:
        """Total elapsed time across all recorded stages."""
        return round(sum(s.duration_seconds or 0.0 for s in self._stages), 4)

    def timings(self) -> dict[str, Optional[float]]:
        """Return a mapping of stage name -> duration in seconds."""
        return {s.stage: s.duration_seconds for s in self._stages}

    def snapshot(self) -> dict:
        """Return a serializable snapshot of the current tracker state."""
        return {
            "evaluation_id": self.evaluation_id,
            "worker_id": self.worker_id,
            "current_stage": self.current_stage,
            "retry_count": self.retry_count,
            "failure_status": self.failure_status,
            "error_code": self.error_code,
            "started_at": self.started_at.isoformat(),
            "total_seconds": self.total_seconds,
            "timings": self.timings(),
        }

    # ----- Internal helpers -----

    def _close_open_stage(self) -> None:
        if self._stages and self._stages[-1].ended_at is None:
            self._stages[-1].ended_at = self._clock()

    async def _persist(self, fields: dict) -> None:
        if self.persist is None:
            return
        try:
            payload = {"worker_id": self.worker_id, **fields}
            await self.persist(self.evaluation_id, payload)
        except Exception as exc:  # persistence must never break processing
            logger.warning(
                "status_persist_failed",
                evaluation_id=self.evaluation_id,
                error=str(exc),
            )
