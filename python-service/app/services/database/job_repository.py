"""
The work queue, as a table.

Claiming is `SELECT ... FOR UPDATE SKIP LOCKED`, which is the part that makes
this safe to run from more than one process: two workers polling at the same
instant take two different rows rather than both taking the first one and
evaluating the same proposal twice. Everything else here is bookkeeping around
that one query.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, or_, select, update

from app.services.database.models import Job
from app.services.database.session import get_session_factory
from app.utils.logging import get_logger

logger = get_logger(__name__)

# States a job is in when it still owes us an outcome.
OPEN_STATUSES = ("queued", "running")

# Priorities. Lower runs first — ingestion is cheap and unblocks a human
# decision, so a backlog of hour-long evaluations must never sit in front of it.
PRIORITY_INGEST = 10
PRIORITY_EVALUATE = 100


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class JobRepository:
    """CRUD + claiming over `jobs`."""

    def __init__(self) -> None:
        self._sessions = get_session_factory()

    # ------------------------------------------------------------------
    # Enqueue
    # ------------------------------------------------------------------

    async def enqueue(
        self,
        *,
        kind: str,
        proposal_id: Optional[str] = None,
        batch_id: Optional[str] = None,
        payload: Optional[dict] = None,
        requested_by: Optional[str] = None,
        priority: Optional[int] = None,
        max_attempts: int = 3,
        dedupe: bool = True,
    ) -> dict[str, Any]:
        """
        Queue a unit of work.

        Deduplicating by default is what makes the UI's bulk actions safe to
        press twice: selecting forty proposals and clicking Evaluate, then
        clicking it again because nothing visibly happened, must not buy eighty
        evaluations. An existing queued-or-running job for the same proposal and
        kind wins, and the second call reports which job it joined.
        """
        if dedupe and proposal_id:
            existing = await self.find_open(kind=kind, proposal_id=proposal_id)
            if existing:
                return {**existing, "deduplicated": True}

        job_id = str(uuid.uuid4())
        now = _utcnow()

        async with self._sessions() as session:
            session.add(
                Job(
                    id=job_id,
                    kind=kind,
                    proposal_id=proposal_id,
                    batch_id=batch_id,
                    payload=payload,
                    requested_by=requested_by,
                    status="queued",
                    priority=(
                        priority
                        if priority is not None
                        else (PRIORITY_INGEST if kind == "ingest" else PRIORITY_EVALUATE)
                    ),
                    max_attempts=max_attempts,
                    available_at=now,
                    created_at=now,
                )
            )
            await session.commit()

        logger.info("job_enqueued", job_id=job_id, kind=kind, proposal_id=proposal_id)
        return {
            "id": job_id,
            "kind": kind,
            "proposal_id": proposal_id,
            "status": "queued",
            "deduplicated": False,
        }

    async def find_open(self, *, kind: str, proposal_id: str) -> Optional[dict]:
        """An unfinished job of this kind for this proposal, if there is one."""
        async with self._sessions() as session:
            row = (
                await session.execute(
                    select(Job)
                    .where(
                        Job.kind == kind,
                        Job.proposal_id == proposal_id,
                        Job.status.in_(OPEN_STATUSES),
                    )
                    .order_by(Job.created_at)
                    .limit(1)
                )
            ).scalar_one_or_none()
            return self._to_dict(row) if row else None

    # ------------------------------------------------------------------
    # Claim / complete
    # ------------------------------------------------------------------

    async def claim(
        self, worker_id: str, *, kinds: Optional[tuple[str, ...]] = None
    ) -> Optional[dict]:
        """
        Take the next runnable job, atomically.

        SKIP LOCKED means a worker never blocks waiting for a row another worker
        is already claiming — it steps over it and takes the next one. Without
        it, N workers polling a queue serialise behind the same row lock and the
        pool degenerates to a single worker.

        `kinds` restricts what this worker will pick up. That is how the pool
        reserves slots for cheap ingestion work: without it, a handful of
        ten-minute evaluations would occupy every slot and a document uploaded
        in the meantime would sit unextracted until one of them finished.
        """
        now = _utcnow()

        async with self._sessions() as session:
            async with session.begin():
                query = (
                    select(Job)
                    .where(Job.status == "queued", Job.available_at <= now)
                    .order_by(Job.priority.asc(), Job.available_at.asc())
                    .limit(1)
                    .with_for_update(skip_locked=True)
                )
                if kinds:
                    query = query.where(Job.kind.in_(kinds))

                row = (await session.execute(query)).scalar_one_or_none()

                if row is None:
                    return None

                row.status = "running"
                row.worker_id = worker_id
                row.attempts = (row.attempts or 0) + 1
                row.started_at = row.started_at or now
                row.heartbeat_at = now

                claimed = self._to_dict(row)

        logger.info(
            "job_claimed",
            job_id=claimed["id"],
            kind=claimed["kind"],
            attempt=claimed["attempts"],
        )
        return claimed

    async def heartbeat(self, job_id: str) -> None:
        """Say the worker is still alive. Silence for long enough means it is not."""
        async with self._sessions() as session:
            await session.execute(
                update(Job).where(Job.id == job_id).values(heartbeat_at=_utcnow())
            )
            await session.commit()

    async def succeed(self, job_id: str, result: Optional[dict] = None) -> None:
        now = _utcnow()
        async with self._sessions() as session:
            await session.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="succeeded",
                    result=result,
                    error=None,
                    finished_at=now,
                    worker_id=None,
                )
            )
            await session.commit()
        logger.info("job_succeeded", job_id=job_id)

    async def fail(self, job_id: str, error: str, *, retry_in_seconds: int = 60) -> bool:
        """
        Record a failure, and requeue it if it has attempts left.

        Returns True if the job will be retried. The backoff is deliberate: most
        failures at this layer are a rate limit or a transient upstream, and
        retrying instantly just burns the remaining attempts against the same
        wall.
        """
        now = _utcnow()

        async with self._sessions() as session:
            async with session.begin():
                row = (
                    await session.execute(select(Job).where(Job.id == job_id))
                ).scalar_one_or_none()
                if row is None:
                    return False

                row.error = error[:4000]
                row.worker_id = None
                will_retry = row.attempts < row.max_attempts

                if will_retry:
                    row.status = "queued"
                    # Exponential-ish: 1 min, 2 min, 4 min.
                    row.available_at = now + timedelta(
                        seconds=retry_in_seconds * (2 ** (row.attempts - 1))
                    )
                else:
                    row.status = "failed"
                    row.finished_at = now

        logger.warning(
            "job_failed", job_id=job_id, will_retry=will_retry, error=error[:200]
        )
        return will_retry

    async def cancel(self, job_id: str) -> bool:
        """Cancel a job that has not started. A running job is left alone."""
        async with self._sessions() as session:
            result = await session.execute(
                update(Job)
                .where(Job.id == job_id, Job.status == "queued")
                .values(status="cancelled", finished_at=_utcnow())
            )
            await session.commit()
            return result.rowcount > 0

    # ------------------------------------------------------------------
    # Crash recovery
    # ------------------------------------------------------------------

    async def reclaim_stalled(self, *, stale_after_seconds: int = 900) -> int:
        """
        Requeue jobs whose worker stopped heartbeating.

        This is the mechanism behind "close your laptop, or the server restarts,
        and the work still finishes". A job that was mid-flight when the process
        died has a `running` row with a heartbeat that stops advancing; the next
        sweep hands it to a live worker. It is bounded by `max_attempts`, so a
        job that reliably kills its worker eventually stops being retried rather
        than crash-looping the service forever.
        """
        cutoff = _utcnow() - timedelta(seconds=stale_after_seconds)

        async with self._sessions() as session:
            async with session.begin():
                rows = (
                    (
                        await session.execute(
                            select(Job).where(
                                Job.status == "running",
                                or_(
                                    Job.heartbeat_at.is_(None),
                                    Job.heartbeat_at < cutoff,
                                ),
                            )
                        )
                    )
                    .scalars()
                    .all()
                )

                reclaimed = 0
                for row in rows:
                    if row.attempts >= row.max_attempts:
                        row.status = "failed"
                        row.error = (
                            "The worker processing this job stopped responding, and the "
                            "job has no attempts left."
                        )
                        row.finished_at = _utcnow()
                    else:
                        row.status = "queued"
                        row.worker_id = None
                        row.available_at = _utcnow()
                        reclaimed += 1

        if rows:
            logger.warning(
                "stalled_jobs_reclaimed", requeued=reclaimed, abandoned=len(rows) - reclaimed
            )
        return reclaimed

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    async def get(self, job_id: str) -> Optional[dict]:
        async with self._sessions() as session:
            row = (
                await session.execute(select(Job).where(Job.id == job_id))
            ).scalar_one_or_none()
            return self._to_dict(row) if row else None

    async def list_jobs(
        self,
        *,
        page: int = 1,
        limit: int = 20,
        status: Optional[str] = None,
        kind: Optional[str] = None,
        proposal_id: Optional[str] = None,
    ) -> dict:
        filters = []
        if status:
            filters.append(Job.status == status)
        if kind:
            filters.append(Job.kind == kind)
        if proposal_id:
            filters.append(Job.proposal_id == proposal_id)

        async with self._sessions() as session:
            count_q = select(func.count()).select_from(Job)
            # Open work first (a queue the operator can act on), then history.
            list_q = select(Job).order_by(
                Job.status.in_(OPEN_STATUSES).desc(),
                Job.priority.asc(),
                Job.created_at.desc(),
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
                "jobs": [self._to_dict(r) for r in rows],
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": (total + limit - 1) // limit if limit else 0,
            }

    async def stats(self) -> dict:
        """
        Queue depth by kind and status.

        This is what the UI shows to answer "is anything still happening?" —
        the question an operator has every right to ask after uploading forty
        documents and walking away.
        """
        async with self._sessions() as session:
            rows = (
                await session.execute(
                    select(Job.kind, Job.status, func.count())
                    .group_by(Job.kind, Job.status)
                )
            ).all()

            oldest = (
                await session.execute(
                    select(func.min(Job.created_at)).where(Job.status == "queued")
                )
            ).scalar()

        by_kind: dict[str, dict[str, int]] = {}
        totals = {"queued": 0, "running": 0, "succeeded": 0, "failed": 0, "cancelled": 0}

        for kind, status, count in rows:
            by_kind.setdefault(kind, {})[status] = count
            totals[status] = totals.get(status, 0) + count

        return {
            "by_kind": by_kind,
            "totals": totals,
            "pending": totals["queued"] + totals["running"],
            "oldest_queued_at": oldest.isoformat() if oldest else None,
        }

    async def purge_finished(self, *, older_than_days: int = 30) -> int:
        """Keep the table from growing without bound. History older than a month
        is in the audit log anyway."""
        cutoff = _utcnow() - timedelta(days=older_than_days)
        async with self._sessions() as session:
            result = await session.execute(
                sa_delete(Job).where(
                    Job.status.in_(("succeeded", "cancelled")),
                    Job.finished_at < cutoff,
                )
            )
            await session.commit()
            return result.rowcount

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def _to_dict(self, row: Job) -> dict:
        return {
            "id": row.id,
            "kind": row.kind,
            "proposal_id": row.proposal_id,
            "batch_id": row.batch_id,
            "payload": row.payload,
            "status": row.status,
            "priority": row.priority,
            "attempts": row.attempts,
            "max_attempts": row.max_attempts,
            "error": row.error,
            "result": row.result,
            "requested_by": row.requested_by,
            "worker_id": row.worker_id,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "started_at": row.started_at.isoformat() if row.started_at else None,
            "finished_at": row.finished_at.isoformat() if row.finished_at else None,
            "available_at": row.available_at.isoformat() if row.available_at else None,
        }


_repo: Optional[JobRepository] = None


def get_job_repository() -> JobRepository:
    global _repo
    if _repo is None:
        _repo = JobRepository()
    return _repo


def reset_job_repository() -> None:
    """Used by tests."""
    global _repo
    _repo = None
