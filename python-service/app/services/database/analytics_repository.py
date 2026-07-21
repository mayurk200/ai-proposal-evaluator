"""
Analytics about the work itself, as distinct from the approval ledger.

`registry_repository` answers the client's questions about *decisions* — who was
approved, in which category, when. This module answers the questions an operator
running the system has about the *pipeline*: what is stuck, what did the scoring
actually look like, what has it cost, and what should I look at next.

Both matter, and they are kept apart because they have different truth sources.
Approval history is the append-only `decisions` ledger and must never change
retroactively. Pipeline state is the current state of `proposals`, `evaluations`
and `jobs`, and is expected to move under you while you watch it.

Everything here is an aggregate computed in SQL. At a thousand proposals the
difference between GROUP BY and pulling rows into Python to count them is the
difference between a dashboard and a timeout.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import Float, case, cast, func, select

from app.services.database.models import (
    Category,
    Evaluation,
    Proposal,
    SimilarityMatch,
)
from app.services.database.session import get_session_factory
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Score bands for the distribution. Aligned with the recommendation thresholds so
# the histogram and the verdicts tell the same story rather than two.
SCORE_BANDS = (
    (0, 40, "0-40"),
    (40, 55, "40-55"),
    (55, 70, "55-70"),
    (70, 85, "70-85"),
    (85, 101, "85-100"),
)

# The lifecycle, in order. Rendering a funnel needs the order to be a property of
# the data, not of whatever sequence the database happened to return.
PIPELINE_STAGES = (
    ("uploaded", "Uploaded"),
    ("extracting", "Extracting"),
    ("extracted", "Extracted"),
    ("metadata_ready", "Metadata ready"),
    ("pending_review", "Awaiting duplicate review"),
    ("queued", "Ready to evaluate"),
    ("evaluating", "Evaluating"),
    ("evaluated", "Evaluated"),
    ("skipped", "Skipped as duplicate"),
    ("failed", "Failed"),
)


class AnalyticsRepository:
    def __init__(self) -> None:
        self._sessions = get_session_factory()

    # ------------------------------------------------------------------
    # Pipeline
    # ------------------------------------------------------------------

    async def pipeline(self) -> dict:
        """
        Where every idea in the archive currently sits.

        The stage counts are the honest answer to "what is the system doing?" —
        including the two answers nobody wants but everybody needs: how many are
        stuck waiting on a human, and how many failed.
        """
        async with self._sessions() as session:
            rows = (
                await session.execute(
                    select(Proposal.status, func.count()).group_by(Proposal.status)
                )
            ).all()

            total = (
                await session.execute(select(func.count()).select_from(Proposal))
            ).scalar() or 0

            # Ideas we hold metadata for but have never scored, duplicates
            # excluded. This is the working list an admin picks from, so its size
            # is a number they should see without navigating to it.
            actionable = (
                await session.execute(
                    select(func.count())
                    .select_from(Proposal)
                    .where(
                        Proposal.is_evaluated.is_(False),
                        Proposal.review_decision == "approved_for_eval",
                    )
                )
            ).scalar() or 0

        counts = dict(rows)
        return {
            "total": total,
            "awaiting_evaluation": actionable,
            "stages": [
                {"key": key, "label": label, "count": counts.get(key, 0)}
                for key, label in PIPELINE_STAGES
            ],
        }

    # ------------------------------------------------------------------
    # Scores
    # ------------------------------------------------------------------

    async def score_distribution(self) -> dict:
        """
        How the scores actually came out.

        A single average hides the shape completely: a mean of 62 could be every
        proposal scoring 62, or half at 30 and half at 94. Those two portfolios
        call for entirely different decisions, so the histogram is the point and
        the mean is the footnote.
        """
        band_expr = case(
            *[
                (
                    (Proposal.latest_score >= low) & (Proposal.latest_score < high),
                    label,
                )
                for low, high, label in SCORE_BANDS
            ],
            else_="unscored",
        )

        async with self._sessions() as session:
            rows = (
                await session.execute(
                    select(band_expr.label("band"), func.count())
                    .where(Proposal.latest_score.is_not(None))
                    .group_by(band_expr)
                )
            ).all()

            summary = (
                await session.execute(
                    select(
                        func.count(),
                        func.avg(Proposal.latest_score),
                        func.min(Proposal.latest_score),
                        func.max(Proposal.latest_score),
                        func.percentile_cont(0.5).within_group(
                            Proposal.latest_score.asc()
                        ),
                    ).where(Proposal.latest_score.is_not(None))
                )
            ).one()

            by_recommendation = (
                await session.execute(
                    select(Proposal.latest_recommendation, func.count())
                    .where(Proposal.latest_recommendation.is_not(None))
                    .group_by(Proposal.latest_recommendation)
                    .order_by(func.count().desc())
                )
            ).all()

        counts = dict(rows)
        scored, mean, lowest, highest, median = summary

        return {
            "scored": scored or 0,
            "average": round(float(mean), 1) if mean is not None else None,
            "median": round(float(median), 1) if median is not None else None,
            "lowest": round(float(lowest), 1) if lowest is not None else None,
            "highest": round(float(highest), 1) if highest is not None else None,
            "bands": [
                {"band": label, "count": counts.get(label, 0)}
                for _, _, label in SCORE_BANDS
            ],
            "by_recommendation": [
                {"recommendation": rec, "count": count} for rec, count in by_recommendation
            ],
        }

    async def score_by_category(self) -> list[dict]:
        """
        Average score per category, with the spread.

        Answers a question the approval counts cannot: are we approving one idea
        per category because each category has one strong idea, or because we
        have decided to approve one per category regardless of quality?
        """
        async with self._sessions() as session:
            rows = (
                await session.execute(
                    select(
                        Category.id,
                        Category.label,
                        func.count(Proposal.id),
                        func.avg(Proposal.latest_score),
                        func.min(Proposal.latest_score),
                        func.max(Proposal.latest_score),
                    )
                    .join(Proposal, Proposal.category_id == Category.id)
                    .where(Proposal.latest_score.is_not(None))
                    .group_by(Category.id, Category.label)
                    .order_by(func.avg(Proposal.latest_score).desc())
                )
            ).all()

        return [
            {
                "category_id": cid,
                "label": label,
                "evaluated_count": count,
                "average_score": round(float(avg), 1) if avg is not None else None,
                "lowest": round(float(lo), 1) if lo is not None else None,
                "highest": round(float(hi), 1) if hi is not None else None,
            }
            for cid, label, count, avg, lo, hi in rows
        ]

    async def top_proposals(self, *, limit: int = 10, undecided_only: bool = True) -> list[dict]:
        """
        The strongest ideas, optionally only those with no decision recorded.

        `undecided_only` is what makes this a worklist rather than a leaderboard:
        a high-scoring idea nobody has ruled on is the single most actionable row
        in the system.
        """
        from app.services.database.models import Decision

        async with self._sessions() as session:
            query = (
                select(
                    Proposal.id,
                    Proposal.title,
                    Proposal.filename,
                    Proposal.latest_score,
                    Proposal.latest_recommendation,
                    Category.label,
                )
                .outerjoin(Category, Category.id == Proposal.category_id)
                .where(Proposal.latest_score.is_not(None))
                .order_by(Proposal.latest_score.desc())
                .limit(limit)
            )

            if undecided_only:
                decided = select(Decision.proposal_id).distinct()
                query = query.where(Proposal.id.not_in(decided))

            rows = (await session.execute(query)).all()

        return [
            {
                "proposal_id": pid,
                "title": title or filename,
                "score": round(float(score), 1),
                "recommendation": rec,
                "category": category,
            }
            for pid, title, filename, score, rec, category in rows
        ]

    # ------------------------------------------------------------------
    # Throughput
    # ------------------------------------------------------------------

    async def throughput(self, *, months: int = 12) -> list[dict]:
        """
        Ideas received vs ideas scored, by month.

        Two series rather than one because the gap between them is the backlog,
        and a backlog that grows every month is the thing you want to notice
        early rather than discover at the deadline.
        """
        received_col = func.to_char(Proposal.created_at, "YYYY-MM")
        evaluated_col = func.to_char(Proposal.evaluated_at, "YYYY-MM")

        async with self._sessions() as session:
            received = (
                await session.execute(
                    select(received_col.label("period"), func.count())
                    .group_by(received_col)
                    .order_by(received_col.desc())
                    .limit(months)
                )
            ).all()

            evaluated = (
                await session.execute(
                    select(evaluated_col.label("period"), func.count())
                    .where(Proposal.evaluated_at.is_not(None))
                    .group_by(evaluated_col)
                    .order_by(evaluated_col.desc())
                    .limit(months)
                )
            ).all()

        received_map = dict(received)
        evaluated_map = dict(evaluated)

        periods = sorted(set(received_map) | set(evaluated_map))
        return [
            {
                "period": period,
                "received": received_map.get(period, 0),
                "evaluated": evaluated_map.get(period, 0),
            }
            for period in periods
        ]

    # ------------------------------------------------------------------
    # Cost and reliability
    # ------------------------------------------------------------------

    async def operations(self) -> dict:
        """
        What the pipeline has cost and how reliably it runs.

        Tokens are real money and evaluation is by far the largest line item, so
        the average cost of one evaluation is worth putting on screen next to the
        number of evaluations queued.
        """
        async with self._sessions() as session:
            evaluation_stats = (
                await session.execute(
                    select(
                        func.count(),
                        func.sum(Evaluation.total_tokens),
                        func.avg(Evaluation.total_tokens),
                        func.avg(Evaluation.total_duration_ms),
                    ).where(Evaluation.status == "completed")
                )
            ).one()

            by_status = (
                await session.execute(
                    select(Evaluation.status, func.count()).group_by(Evaluation.status)
                )
            ).all()

            # Where processing dies. Grouped by stage because "extraction keeps
            # failing" and "the LLM keeps timing out" are different problems with
            # different fixes, and a single failure count conflates them.
            failures = (
                await session.execute(
                    select(Proposal.error_stage, func.count())
                    .where(Proposal.status == "failed")
                    .group_by(Proposal.error_stage)
                    .order_by(func.count().desc())
                )
            ).all()

            # Evidence coverage lives inside the report blob. Reading it in SQL
            # beats pulling every report into Python to average one float.
            coverage = (
                await session.execute(
                    select(
                        func.avg(
                            cast(
                                Evaluation.report["evaluation"]["evidence_coverage"].astext,
                                Float,
                            )
                        )
                    ).where(Evaluation.status == "completed")
                )
            ).scalar()

            model = (
                await session.execute(
                    select(Evaluation.model_used, func.count())
                    .where(Evaluation.model_used.is_not(None))
                    .group_by(Evaluation.model_used)
                    .order_by(func.count().desc())
                    .limit(1)
                )
            ).first()

        count, total_tokens, avg_tokens, avg_ms = evaluation_stats
        statuses = dict(by_status)

        return {
            "evaluations_completed": count or 0,
            "evaluations_failed": statuses.get("failed", 0),
            "evaluations_in_flight": statuses.get("processing", 0),
            "total_tokens": int(total_tokens or 0),
            "average_tokens_per_evaluation": int(avg_tokens) if avg_tokens else 0,
            "average_seconds_per_evaluation": (
                round(float(avg_ms) / 1000, 1) if avg_ms else 0
            ),
            "average_evidence_coverage": (
                round(float(coverage), 3) if coverage is not None else None
            ),
            "model": model[0] if model else None,
            "failures_by_stage": [
                {"stage": stage or "unknown", "count": count} for stage, count in failures
            ],
        }

    async def duplicates(self) -> dict:
        """
        What the duplicate gate has actually caught, and what that saved.

        The saving is the argument for the gate existing: ingestion costs one
        small LLM call, an evaluation costs tens of thousands of tokens, so every
        idea correctly ruled a duplicate is an evaluation not paid for. Estimated
        against this system's own measured average rather than a guess — and
        reported as `None` rather than a made-up number when nothing has been
        evaluated yet and there is no average to estimate from.
        """
        async with self._sessions() as session:
            flagged = (
                await session.execute(
                    select(func.count(func.distinct(SimilarityMatch.proposal_id)))
                )
            ).scalar() or 0

            confirmed = (
                await session.execute(
                    select(func.count())
                    .select_from(Proposal)
                    .where(Proposal.review_decision == "skipped_duplicate")
                )
            ).scalar() or 0

            pending = (
                await session.execute(
                    select(func.count())
                    .select_from(Proposal)
                    .where(Proposal.review_decision == "pending")
                )
            ).scalar() or 0

            dismissed = (
                await session.execute(
                    select(func.count())
                    .select_from(SimilarityMatch)
                    .where(SimilarityMatch.status == "dismissed")
                )
            ).scalar() or 0

            avg_tokens = (
                await session.execute(
                    select(func.avg(Evaluation.total_tokens)).where(
                        Evaluation.status == "completed"
                    )
                )
            ).scalar()

        return {
            "flagged_by_gate": flagged,
            "confirmed_duplicates": confirmed,
            "awaiting_review": pending,
            "dismissed_as_distinct": dismissed,
            "estimated_tokens_saved": (
                int(confirmed * float(avg_tokens)) if avg_tokens and confirmed else None
            ),
        }


_repo: Optional[AnalyticsRepository] = None


def get_analytics_repository() -> AnalyticsRepository:
    global _repo
    if _repo is None:
        _repo = AnalyticsRepository()
    return _repo


def reset_analytics_repository() -> None:
    """Used by tests."""
    global _repo
    _repo = None
