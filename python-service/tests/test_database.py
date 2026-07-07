"""
Tests for app.services.database.repository — EvaluationRepository CRUD.
Uses SQLite in-memory for fast, isolated tests (SQLAlchemy async with aiosqlite).
"""

import pytest
from datetime import datetime, timezone

from app.services.database.repository import EvaluationRepository


# Use SQLite in-memory for tests (fast, no external deps)
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def repo():
    """Create a fresh in-memory repository per test."""
    r = EvaluationRepository(database_url=TEST_DB_URL)
    await r.init_tables()
    yield r
    await r.close()


# ============================================================================
# Save & Get
# ============================================================================


class TestSaveAndGet:
    @pytest.mark.asyncio
    async def test_save_returns_uuid(self, repo):
        eval_id = await repo.save_evaluation(filename="test.pdf")
        assert eval_id
        assert len(eval_id) == 36  # UUID format

    @pytest.mark.asyncio
    async def test_get_existing_record(self, repo):
        eval_id = await repo.save_evaluation(
            filename="proposal.pdf",
            file_storage_key="proposals/abc_proposal.pdf",
            file_storage_url="http://storage/proposals/abc_proposal.pdf",
            file_size_bytes=50000,
            file_content_type="application/pdf",
            overall_score=72.5,
            recommendation="Recommended",
            evaluation_report={"evaluation": {"overall_score": 72.5}},
            document_metadata={"filename": "proposal.pdf", "total_pages": 10},
            status="completed",
        )

        record = await repo.get_evaluation(eval_id)
        assert record is not None
        assert record["id"] == eval_id
        assert record["filename"] == "proposal.pdf"
        assert record["overall_score"] == 72.5
        assert record["recommendation"] == "Recommended"
        assert record["evaluation_report"]["evaluation"]["overall_score"] == 72.5
        assert record["document_metadata"]["total_pages"] == 10
        assert record["status"] == "completed"
        assert record["file_storage_key"] == "proposals/abc_proposal.pdf"

    @pytest.mark.asyncio
    async def test_get_nonexistent_returns_none(self, repo):
        record = await repo.get_evaluation("nonexistent-id")
        assert record is None

    @pytest.mark.asyncio
    async def test_find_by_proposal(self, repo):
        """Evaluations linked to a proposal are found; only completed ones count."""
        await repo.save_evaluation(filename="a.pdf", proposal_id="prop-1", status="failed")
        newest = await repo.save_evaluation(
            filename="b.pdf", proposal_id="prop-1", status="completed", overall_score=64.0
        )

        found = await repo.find_by_proposal("prop-1")
        assert found is not None
        assert found["id"] == newest
        assert found["proposal_id"] == "prop-1"
        assert found["overall_score"] == 64.0

        assert await repo.find_by_proposal("prop-unknown") is None
        assert await repo.find_by_proposal("") is None


# ============================================================================
# List with Pagination
# ============================================================================


class TestListEvaluations:
    @pytest.mark.asyncio
    async def test_empty_list(self, repo):
        result = await repo.list_evaluations()
        assert result["total"] == 0
        assert result["evaluations"] == []
        assert result["page"] == 1

    @pytest.mark.asyncio
    async def test_list_with_pagination(self, repo):
        # Create 5 records
        for i in range(5):
            await repo.save_evaluation(filename=f"file_{i}.pdf", overall_score=float(i * 10))

        # Page 1, limit 2
        result = await repo.list_evaluations(page=1, limit=2)
        assert result["total"] == 5
        assert len(result["evaluations"]) == 2
        assert result["total_pages"] == 3

        # Page 3, limit 2
        result = await repo.list_evaluations(page=3, limit=2)
        assert len(result["evaluations"]) == 1

    @pytest.mark.asyncio
    async def test_list_filter_by_status(self, repo):
        await repo.save_evaluation(filename="ok.pdf", status="completed")
        await repo.save_evaluation(filename="fail.pdf", status="failed")
        await repo.save_evaluation(filename="ok2.pdf", status="completed")

        result = await repo.list_evaluations(status="completed")
        assert result["total"] == 2
        assert all(e["status"] == "completed" for e in result["evaluations"])

    @pytest.mark.asyncio
    async def test_list_summary_format(self, repo):
        await repo.save_evaluation(
            filename="test.pdf",
            overall_score=80.0,
            evaluation_report={"big": "json_data"},
        )
        result = await repo.list_evaluations()
        record = result["evaluations"][0]
        # Summary should NOT include the full evaluation_report
        assert "evaluation_report" not in record
        assert "overall_score" in record
        assert "filename" in record


# ============================================================================
# Get by IDs (for comparison)
# ============================================================================


class TestGetByIds:
    @pytest.mark.asyncio
    async def test_get_multiple(self, repo):
        id1 = await repo.save_evaluation(filename="a.pdf", overall_score=60.0)
        id2 = await repo.save_evaluation(filename="b.pdf", overall_score=80.0)
        await repo.save_evaluation(filename="c.pdf", overall_score=90.0)

        records = await repo.get_evaluations_by_ids([id1, id2])
        assert len(records) == 2
        filenames = {r["filename"] for r in records}
        assert filenames == {"a.pdf", "b.pdf"}

    @pytest.mark.asyncio
    async def test_get_partial_ids(self, repo):
        id1 = await repo.save_evaluation(filename="a.pdf")
        records = await repo.get_evaluations_by_ids([id1, "nonexistent"])
        assert len(records) == 1


# ============================================================================
# Batch queries
# ============================================================================


class TestBatchQueries:
    @pytest.mark.asyncio
    async def test_get_by_batch_id(self, repo):
        batch_id = "batch-001"
        await repo.save_evaluation(filename="f1.pdf", batch_id=batch_id, overall_score=70)
        await repo.save_evaluation(filename="f2.pdf", batch_id=batch_id, overall_score=80)
        await repo.save_evaluation(filename="f3.pdf", batch_id="other-batch", overall_score=90)

        records = await repo.get_evaluations_by_batch(batch_id)
        assert len(records) == 2
        assert all(r["batch_id"] == batch_id for r in records)

    @pytest.mark.asyncio
    async def test_empty_batch(self, repo):
        records = await repo.get_evaluations_by_batch("no-such-batch")
        assert records == []


# ============================================================================
# Update
# ============================================================================


class TestUpdateEvaluation:
    @pytest.mark.asyncio
    async def test_update_fields(self, repo):
        eval_id = await repo.save_evaluation(filename="test.pdf", status="processing")
        updated = await repo.update_evaluation(
            eval_id,
            status="completed",
            overall_score=85.0,
            recommendation="Highly Recommended",
        )
        assert updated is True

        record = await repo.get_evaluation(eval_id)
        assert record["status"] == "completed"
        assert record["overall_score"] == 85.0
        assert record["recommendation"] == "Highly Recommended"

    @pytest.mark.asyncio
    async def test_update_json_field(self, repo):
        eval_id = await repo.save_evaluation(filename="test.pdf")
        await repo.update_evaluation(
            eval_id,
            evaluation_report={"evaluation": {"overall_score": 95}},
        )
        record = await repo.get_evaluation(eval_id)
        assert record["evaluation_report"]["evaluation"]["overall_score"] == 95

    @pytest.mark.asyncio
    async def test_update_nonexistent(self, repo):
        result = await repo.update_evaluation("fake-id", status="completed")
        assert result is False


# ============================================================================
# Delete
# ============================================================================


class TestDeleteEvaluation:
    @pytest.mark.asyncio
    async def test_delete_existing(self, repo):
        eval_id = await repo.save_evaluation(filename="to_delete.pdf")
        deleted = await repo.delete_evaluation(eval_id)
        assert deleted is True
        assert await repo.get_evaluation(eval_id) is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent(self, repo):
        deleted = await repo.delete_evaluation("fake-id")
        assert deleted is False
