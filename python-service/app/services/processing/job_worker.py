"""
The worker pool that drains the job queue.

This is the piece that makes the backend independent of the frontend. An
operator uploads twenty documents and closes their laptop; the HTTP request that
carried the bytes is long finished, but the twenty jobs are rows in Postgres and
this pool works through them regardless. When the operator comes back, the
metadata is there and the ideas are waiting to be evaluated — or already were,
if they asked for that too.

Two knobs, and they mean different things:

  INGEST slots     — extraction and OCR, which are CPU-bound and local. Several
                     can run at once without touching the token budget.
  EVALUATE slots   — the agent pipeline. Bounded low, because the real limiter
                     is tokens-per-minute and queueing a thundering herd behind
                     the TPM limiter buys nothing but memory.

Both are deliberately small. The queue is the buffer; concurrency is not.
"""

from __future__ import annotations

import asyncio
import os
import socket
import uuid
from typing import Optional

from app.services.database.job_repository import get_job_repository
from app.utils.logging import get_logger

logger = get_logger(__name__)

# How often an idle worker asks for work. Short enough that an upload feels
# immediate, long enough that an idle service is not hammering Postgres.
POLL_INTERVAL_SECONDS = 2.0

# How often a busy worker says it is still alive. Must be comfortably under
# STALE_AFTER_SECONDS or a healthy long evaluation would be reclaimed from under
# itself and run twice.
HEARTBEAT_INTERVAL_SECONDS = 30.0

# A job whose worker has been silent this long is presumed dead and requeued.
# Sized above the longest plausible evaluation: seven agent calls paced by a
# free-tier token budget genuinely can take ten minutes, and reclaiming one
# early would mean paying for it twice.
STALE_AFTER_SECONDS = 900

# How often to sweep for jobs abandoned by a dead process.
RECLAIM_INTERVAL_SECONDS = 120


class JobWorker:
    """A pool of coroutines that claim jobs and run them."""

    def __init__(self, *, ingest_slots: int = 2, evaluate_slots: int = 2) -> None:
        self.ingest_slots = ingest_slots
        self.evaluate_slots = evaluate_slots
        self._tasks: list[asyncio.Task] = []
        self._running = False
        # Identifies this process in the `jobs.worker_id` column, so a stuck job
        # can be traced back to the process that was holding it.
        self._id_prefix = f"{socket.gethostname()}:{os.getpid()}"

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        if self._running:
            return
        self._running = True

        jobs = get_job_repository()

        # Anything left `running` from a previous process is, by definition,
        # abandoned — this process is the only one that could have owned it, and
        # it just started. Requeue before the pool comes up so recovered work is
        # picked up in the first poll rather than in fifteen minutes.
        reclaimed = await jobs.reclaim_stalled(stale_after_seconds=0)
        if reclaimed:
            logger.info("resumed_interrupted_jobs", count=reclaimed)

        # Ingest-only slots first. These are the reserved ones — they refuse
        # evaluation work so that extraction is never queued behind it.
        for index in range(self.ingest_slots):
            self._tasks.append(
                asyncio.create_task(self._loop(f"ingest-{index}", kinds=("ingest",)))
            )
        # General slots take anything, and `priority` still puts ingestion first,
        # so these help with a backlog rather than sitting idle.
        for index in range(self.evaluate_slots):
            self._tasks.append(asyncio.create_task(self._loop(f"any-{index}")))

        self._tasks.append(asyncio.create_task(self._reclaim_loop()))

        logger.info(
            "job_worker_started",
            ingest_slots=self.ingest_slots,
            evaluate_slots=self.evaluate_slots,
        )

    async def stop(self) -> None:
        """
        Stop claiming new work and let in-flight jobs go.

        In-flight jobs are cancelled rather than awaited: shutdown must not block
        for the ten minutes an evaluation might need. Cancelling leaves the row
        `running` with a stale heartbeat, which the next process reclaims — the
        work is delayed, never lost.
        """
        self._running = False
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        logger.info("job_worker_stopped")

    # ------------------------------------------------------------------
    # The loop
    # ------------------------------------------------------------------

    async def _loop(self, slot: str, kinds: Optional[tuple[str, ...]] = None) -> None:
        worker_id = f"{self._id_prefix}:{slot}"
        jobs = get_job_repository()

        while self._running:
            try:
                job = await jobs.claim(worker_id, kinds=kinds)
                if job is None:
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)
                    continue

                await self._run_with_heartbeat(job)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # The loop itself must never die. A worker that exits on a
                # transient database blip takes a slot with it permanently, and
                # the queue silently stops draining.
                logger.error("job_loop_error", worker=worker_id, error=str(exc))
                await asyncio.sleep(POLL_INTERVAL_SECONDS)

    async def _run_with_heartbeat(self, job: dict) -> None:
        """Run one job, keeping its lease alive while it works."""
        jobs = get_job_repository()

        async def beat() -> None:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
                await jobs.heartbeat(job["id"])

        heartbeat = asyncio.create_task(beat())
        try:
            result = await self._dispatch(job)
            await jobs.succeed(job["id"], result)
        except asyncio.CancelledError:
            # Shutdown. Leave the row `running` — it will be reclaimed.
            raise
        except Exception as exc:
            await jobs.fail(job["id"], str(exc))
        finally:
            heartbeat.cancel()

    async def _dispatch(self, job: dict) -> Optional[dict]:
        """
        Route a job to the code that does the work.

        Deliberately thin. The services already know how to record their own
        failures on the proposal row, so a job failing here is about the queue,
        not about the domain.
        """
        kind = job["kind"]
        proposal_id = job["proposal_id"]
        payload = job.get("payload") or {}

        if kind == "ingest":
            from app.services.processing.ingestion_service import get_ingestion_service

            return await get_ingestion_service().process(proposal_id)

        if kind == "evaluate":
            from app.services.processing.evaluation_service import get_evaluation_service

            result = await get_evaluation_service().evaluate(
                proposal_id,
                triggered_by=job.get("requested_by"),
                force=bool(payload.get("force")),
                batch_id=job.get("batch_id"),
            )
            # The full report is already in `evaluations`; storing a second copy
            # on the job row would double the storage for no reader.
            return {
                "evaluation_id": result.get("id"),
                "overall_score": result.get("overall_score"),
                "recommendation": result.get("recommendation"),
                "reused": result.get("reused", False),
            }

        raise ValueError(f"Unknown job kind '{kind}'")

    async def _reclaim_loop(self) -> None:
        """Periodically rescue work abandoned by a process that died."""
        while self._running:
            try:
                await asyncio.sleep(RECLAIM_INTERVAL_SECONDS)
                await get_job_repository().reclaim_stalled(
                    stale_after_seconds=STALE_AFTER_SECONDS
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("reclaim_loop_error", error=str(exc))


_worker: Optional[JobWorker] = None


def get_job_worker() -> JobWorker:
    global _worker
    if _worker is None:
        from app.config import settings

        _worker = JobWorker(
            ingest_slots=settings.WORKER_INGEST_SLOTS,
            evaluate_slots=settings.WORKER_EVALUATE_SLOTS,
        )
    return _worker
