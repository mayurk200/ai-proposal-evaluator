"""
Tests for app.services.processing.batch_processor — batch file evaluation.
All LLM, storage, and database calls are mocked.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.processing.batch_processor import process_batch
from app.models.schemas import (
    DocumentMetadata,
    EvaluationResponse,
    FinalEvaluation,
    ProcessedDocument,
)
from tests.conftest import make_metadata, make_chunk


def _make_mock_storage():
    storage = AsyncMock()
    storage.upload.return_value = "http://storage/proposals/test.pdf"
    return storage


def _make_mock_repo():
    repo = AsyncMock()
    repo.save_evaluation.return_value = "eval-uuid-001"
    repo.update_evaluation.return_value = True
    return repo


def _make_eval_response():
    return EvaluationResponse(
        status="success",
        document_metadata=make_metadata(),
        evaluation=FinalEvaluation(
            overall_score=70.0,
            recommendation="Recommended",
        ),
        agent_results={},
        processing_time_seconds=2.0,
    )


# ============================================================================
# Tests
# ============================================================================


class TestProcessBatch:
    @pytest.mark.asyncio
    @patch("app.services.processing.batch_processor.AgentOrchestrator")
    @patch("app.services.processing.batch_processor.process_document")
    @patch("app.services.processing.batch_processor.asyncio.sleep", new_callable=AsyncMock)
    async def test_successful_batch(self, mock_sleep, mock_process, mock_orch_cls):
        # Setup mocks
        long_text = " ".join(["word"] * 50)
        mock_process.return_value = ProcessedDocument(
            metadata=make_metadata(),
            full_text=long_text,
            chunks=[make_chunk(text=long_text)],
            summary="Summary",
        )

        mock_orch = MagicMock()
        mock_orch.evaluate = AsyncMock(return_value=_make_eval_response())
        mock_orch_cls.return_value = mock_orch

        storage = _make_mock_storage()
        repo = _make_mock_repo()

        files = [
            {"bytes": b"file1content", "filename": "file1.pdf", "content_type": "application/pdf"},
            {"bytes": b"file2content", "filename": "file2.pdf", "content_type": "application/pdf"},
        ]

        result = await process_batch(files, batch_id="test-batch", storage=storage, repo=repo)

        assert result["batch_id"] == "test-batch"
        assert result["total_files"] == 2
        assert result["completed"] == 2
        assert result["failed"] == 0
        assert len(result["results"]) == 2
        assert all(r["status"] == "completed" for r in result["results"])

        # Storage should be called for each file
        assert storage.upload.call_count == 2

        # Repo should save and update for each file
        assert repo.save_evaluation.call_count == 2
        assert repo.update_evaluation.call_count == 2

    @pytest.mark.asyncio
    @patch("app.services.processing.batch_processor.AgentOrchestrator")
    @patch("app.services.processing.batch_processor.process_document")
    @patch("app.services.processing.batch_processor.asyncio.sleep", new_callable=AsyncMock)
    async def test_partial_failure(self, mock_sleep, mock_process, mock_orch_cls):
        """One file succeeds, one fails during processing."""
        long_text = " ".join(["word"] * 50)

        # First call succeeds, second raises
        mock_process.side_effect = [
            ProcessedDocument(
                metadata=make_metadata(),
                full_text=long_text,
                chunks=[make_chunk(text=long_text)],
                summary="OK",
            ),
            Exception("Corrupt PDF"),
        ]

        mock_orch = MagicMock()
        mock_orch.evaluate = AsyncMock(return_value=_make_eval_response())
        mock_orch_cls.return_value = mock_orch

        storage = _make_mock_storage()
        repo = _make_mock_repo()

        files = [
            {"bytes": b"good", "filename": "good.pdf"},
            {"bytes": b"bad", "filename": "bad.pdf"},
        ]

        result = await process_batch(files, storage=storage, repo=repo)

        assert result["completed"] == 1
        assert result["failed"] == 1
        assert result["results"][0]["status"] == "completed"
        assert result["results"][1]["status"] == "failed"
        assert "Corrupt PDF" in result["results"][1]["error"]

    @pytest.mark.asyncio
    @patch("app.services.processing.batch_processor.AgentOrchestrator")
    @patch("app.services.processing.batch_processor.process_document")
    @patch("app.services.processing.batch_processor.asyncio.sleep", new_callable=AsyncMock)
    async def test_insufficient_text(self, mock_sleep, mock_process, mock_orch_cls):
        """File with insufficient extracted text should fail."""
        mock_process.return_value = ProcessedDocument(
            metadata=make_metadata(),
            full_text="short",
            chunks=[],
            summary="",
        )

        storage = _make_mock_storage()
        repo = _make_mock_repo()

        files = [{"bytes": b"tiny", "filename": "tiny.pdf"}]

        result = await process_batch(files, storage=storage, repo=repo)

        assert result["failed"] == 1
        assert "Insufficient text" in result["results"][0]["error"]

    @pytest.mark.asyncio
    async def test_empty_batch(self):
        """Empty file list should produce empty result."""
        storage = _make_mock_storage()
        repo = _make_mock_repo()

        result = await process_batch([], storage=storage, repo=repo)

        assert result["total_files"] == 0
        assert result["completed"] == 0
        assert result["failed"] == 0

    @pytest.mark.asyncio
    @patch("app.services.processing.batch_processor.AgentOrchestrator")
    @patch("app.services.processing.batch_processor.process_document")
    @patch("app.services.processing.batch_processor.asyncio.sleep", new_callable=AsyncMock)
    async def test_generates_batch_id_if_not_provided(self, mock_sleep, mock_process, mock_orch_cls):
        long_text = " ".join(["word"] * 50)
        mock_process.return_value = ProcessedDocument(
            metadata=make_metadata(),
            full_text=long_text,
            chunks=[make_chunk(text=long_text)],
            summary="S",
        )
        mock_orch = MagicMock()
        mock_orch.evaluate = AsyncMock(return_value=_make_eval_response())
        mock_orch_cls.return_value = mock_orch

        storage = _make_mock_storage()
        repo = _make_mock_repo()

        files = [{"bytes": b"data", "filename": "x.pdf"}]
        result = await process_batch(files, storage=storage, repo=repo)

        # batch_id should be auto-generated UUID
        assert len(result["batch_id"]) == 36
