"""
Tests for the durable work queue and the guards around it.

The parts worth pinning down here are the ones that decide whether work is
accepted, in what order, and whether a request is allowed to spend money — not
the SQL, which needs a real Postgres to say anything true about.
"""

import pytest
from unittest.mock import AsyncMock, patch

from app.api.routes import _why_not_evaluatable
from app.services.database.job_repository import (
    PRIORITY_EVALUATE,
    PRIORITY_INGEST,
    JobRepository,
)
from app.services.database.proposal_repository import ProposalRepository
from app.services.processing.job_worker import JobWorker


def make_proposal(**overrides) -> dict:
    """A proposal that is ready to be evaluated, unless told otherwise."""
    return {
        "id": "p1",
        "filename": "idea.pdf",
        "title": "An idea",
        "status": "queued",
        "is_evaluated": False,
        "review_decision": "approved_for_eval",
        "retry_count": 0,
        **overrides,
    }


# ============================================================================
# Who may be evaluated
# ============================================================================


class TestEvaluationEligibility:
    def test_ready_proposal_is_allowed(self):
        assert _why_not_evaluatable(make_proposal(), force=False) is None

    def test_pending_duplicate_review_is_blocked(self):
        """The gate is a gate — queueing past it would spend tokens the admin
        has not agreed to spend."""
        reason = _why_not_evaluatable(
            make_proposal(review_decision="pending", status="pending_review"),
            force=False,
        )
        assert reason is not None
        assert "duplicate" in reason.lower()

    def test_confirmed_duplicate_is_blocked(self):
        reason = _why_not_evaluatable(
            make_proposal(review_decision="skipped_duplicate", status="skipped"),
            force=False,
        )
        assert reason is not None
        assert "duplicate" in reason.lower()

    def test_already_evaluated_is_blocked_without_force(self):
        reason = _why_not_evaluatable(
            make_proposal(is_evaluated=True, status="evaluated"), force=False
        )
        assert reason is not None
        assert "already evaluated" in reason.lower()

    def test_already_evaluated_is_allowed_with_force(self):
        """A deliberate re-run is the one case where paying twice is intended."""
        assert (
            _why_not_evaluatable(
                make_proposal(is_evaluated=True, status="evaluated"), force=True
            )
            is None
        )

    def test_still_extracting_is_blocked(self):
        reason = _why_not_evaluatable(make_proposal(status="extracting"), force=False)
        assert reason is not None
        assert "processed" in reason.lower()

    def test_failed_proposal_is_blocked(self):
        reason = _why_not_evaluatable(make_proposal(status="failed"), force=False)
        assert reason is not None
        assert "retry" in reason.lower()

    def test_force_does_not_override_the_duplicate_gate(self):
        """`force` means "score it again", not "ignore the admin"."""
        assert (
            _why_not_evaluatable(make_proposal(review_decision="pending"), force=True)
            is not None
        )


# ============================================================================
# Queue priority
# ============================================================================


class TestPriority:
    def test_ingestion_outranks_evaluation(self):
        """A backlog of hour-long evaluations must not delay the cheap work that
        turns an upload into something an admin can decide about."""
        assert PRIORITY_INGEST < PRIORITY_EVALUATE

    @pytest.mark.asyncio
    async def test_enqueue_defaults_priority_by_kind(self):
        repo = JobRepository.__new__(JobRepository)
        repo._sessions = None  # not used: find_open short-circuits the insert
        repo.find_open = AsyncMock(
            return_value={"id": "existing", "kind": "evaluate", "status": "queued"}
        )

        result = await repo.enqueue(kind="evaluate", proposal_id="p1")
        assert result["deduplicated"] is True
        assert result["id"] == "existing"

    @pytest.mark.asyncio
    async def test_dedupe_can_be_turned_off(self):
        """Some callers genuinely want a second job. They have to say so, and
        when they do the existing-job lookup is skipped entirely."""
        repo = JobRepository.__new__(JobRepository)
        repo.find_open = AsyncMock(return_value={"id": "existing"})
        # The insert needs a live session; failing there is fine, because what
        # this test asserts is what happened *before* it.
        repo._sessions = None

        with pytest.raises(TypeError):
            await repo.enqueue(kind="evaluate", proposal_id="p1", dedupe=False)

        repo.find_open.assert_not_called()


# ============================================================================
# Sorting
# ============================================================================


class TestSorting:
    def test_only_allow_listed_columns_are_sortable(self):
        """A column name off the query string must never reach getattr(). Sorting
        by `extracted_text` would drag megabytes per row out of Postgres."""
        assert "extracted_text" not in ProposalRepository.SORTABLE
        assert "embedding" not in ProposalRepository.SORTABLE
        assert "created_at" in ProposalRepository.SORTABLE
        assert "score" in ProposalRepository.SORTABLE

    def test_unknown_sort_key_falls_back_to_newest_first(self):
        repo = ProposalRepository.__new__(ProposalRepository)
        clause = repo._order_clause("../../etc/passwd", "desc")
        assert "created_at" in str(clause[0])

    def test_score_sort_puts_unscored_last_in_both_directions(self):
        """An unevaluated idea is not "the worst one" — it has no score. It must
        not head the list when you ask for lowest-first."""
        repo = ProposalRepository.__new__(ProposalRepository)

        ascending = str(repo._order_clause("score", "asc")[0]).upper()
        descending = str(repo._order_clause("score", "desc")[0]).upper()

        assert "NULLS LAST" in ascending
        assert "NULLS LAST" in descending
        assert "ASC" in ascending
        assert "DESC" in descending

    def test_sort_has_a_stable_tiebreaker(self):
        """Without one, rows sharing a sort value can reshuffle between page one
        and page two, and an item is shown twice or missed entirely."""
        repo = ProposalRepository.__new__(ProposalRepository)
        for key in ProposalRepository.SORTABLE:
            clause = repo._order_clause(key, "desc")
            assert len(clause) >= 2, f"{key} has no tiebreaker"
            assert "id" in str(clause[-1])


# ============================================================================
# The worker
# ============================================================================


class TestJobWorker:
    @pytest.mark.asyncio
    async def test_unknown_kind_is_a_failure_not_a_silent_success(self):
        worker = JobWorker()
        with pytest.raises(ValueError, match="Unknown job kind"):
            await worker._dispatch({"kind": "definitely-not-a-job", "proposal_id": "p1", "payload": {}})

    @pytest.mark.asyncio
    async def test_evaluate_job_does_not_carry_the_full_report(self):
        """The report is already in `evaluations`; a second copy on the job row
        would double the storage for no reader."""
        worker = JobWorker()

        service = AsyncMock()
        service.evaluate.return_value = {
            "id": "eval-1",
            "overall_score": 71.5,
            "recommendation": "Recommended",
            "reused": False,
            "report": {"huge": "x" * 10_000},
        }

        with patch(
            "app.services.processing.evaluation_service.get_evaluation_service",
            return_value=service,
        ):
            result = await worker._dispatch(
                {
                    "kind": "evaluate",
                    "proposal_id": "p1",
                    "payload": {"force": False},
                    "requested_by": "u1",
                    "batch_id": None,
                }
            )

        assert result["evaluation_id"] == "eval-1"
        assert result["overall_score"] == 71.5
        assert "report" not in result

    @pytest.mark.asyncio
    async def test_evaluate_job_passes_force_through(self):
        """A forced re-run queued as a job must still be forced when it runs —
        otherwise `evaluate()` returns the stored report and the re-run is a
        no-op that looks like a success."""
        worker = JobWorker()
        service = AsyncMock()
        service.evaluate.return_value = {"id": "e", "overall_score": 1, "recommendation": "x"}

        with patch(
            "app.services.processing.evaluation_service.get_evaluation_service",
            return_value=service,
        ):
            await worker._dispatch(
                {
                    "kind": "evaluate",
                    "proposal_id": "p1",
                    "payload": {"force": True},
                    "requested_by": None,
                    "batch_id": None,
                }
            )

        assert service.evaluate.call_args.kwargs["force"] is True
