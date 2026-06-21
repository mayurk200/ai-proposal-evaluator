"""
Integration tests for app.api.routes — FastAPI endpoints via TestClient.
External services (LLM, OCR, Storage, Database) are mocked.
"""

import io
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import AsyncClient, ASGITransport
from app.main import app
from app.models.schemas import (
    DocumentChunk,
    DocumentMetadata,
    ProcessedDocument,
    FinalEvaluation,
    EvaluationResponse,
)
from tests.conftest import make_chunk, make_metadata


# ============================================================================
# Health check
# ============================================================================

class TestHealthEndpoint:
    @pytest.mark.asyncio
    @patch("app.api.routes.get_storage_backend")
    @patch("app.api.routes.get_repository")
    async def test_health_ok(self, mock_repo, mock_storage):
        mock_repo_instance = MagicMock()
        mock_repo_instance.list_evaluations = AsyncMock(return_value={"evaluations": [], "total": 0})
        mock_repo.return_value = mock_repo_instance
        mock_storage.return_value = MagicMock()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "services" in data
        assert "timestamp" in data


# ============================================================================
# Supported formats
# ============================================================================

class TestSupportedFormats:
    @pytest.mark.asyncio
    async def test_returns_formats(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/supported-formats")
        assert resp.status_code == 200
        data = resp.json()
        assert "pdf" in data["formats"]
        assert data["max_file_size_mb"] > 0


# ============================================================================
# Process document
# ============================================================================

class TestProcessDocument:
    @pytest.mark.asyncio
    async def test_rejects_no_file(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/v1/process-document")
        assert resp.status_code == 422  # FastAPI validation error

    @pytest.mark.asyncio
    async def test_rejects_unsupported_format(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/process-document",
                files={"file": ("test.xyz", b"content", "application/octet-stream")},
            )
        assert resp.status_code == 400
        assert "Unsupported format" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_rejects_empty_file(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/process-document",
                files={"file": ("test.txt", b"", "text/plain")},
            )
        assert resp.status_code == 400
        assert "Empty file" in resp.json()["detail"]

    @pytest.mark.asyncio
    @patch("app.api.routes.process_document")
    async def test_successful_txt_processing(self, mock_process):
        mock_process.return_value = ProcessedDocument(
            metadata=DocumentMetadata(filename="test.txt", format="txt"),
            full_text="Test content here.",
            chunks=[],
        )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/process-document",
                files={"file": ("test.txt", b"Test content here.", "text/plain")},
            )
        assert resp.status_code == 200
        assert resp.json()["status"] == "success"

    @pytest.mark.asyncio
    @patch("app.api.routes.process_document")
    async def test_processing_exception(self, mock_process):
        mock_process.side_effect = Exception("Some parser error")
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/process-document",
                files={"file": ("test.txt", b"Test content here.", "text/plain")},
            )
        assert resp.status_code == 500
        assert "parser error" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_rejects_no_filename(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/process-document",
                files={"file": ("", b"Test content here.", "text/plain")},
            )
        assert resp.status_code == 422


# ============================================================================
# Evaluate endpoint
# ============================================================================

class TestEvaluateEndpoint:
    @pytest.mark.asyncio
    async def test_rejects_unsupported_format(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate",
                files={"file": ("test.exe", b"content", "application/octet-stream")},
            )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_empty_file(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate",
                files={"file": ("test.txt", b"", "text/plain")},
            )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_no_filename(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate",
                files={"file": ("", b"Some content", "text/plain")},
            )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    @patch("app.api.routes.settings")
    async def test_rejects_file_too_large(self, mock_settings):
        mock_settings.max_file_size_bytes = 5
        mock_settings.supported_formats_list = ["txt"]
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate",
                files={"file": ("test.txt", b"Too long content", "text/plain")},
            )
        assert resp.status_code == 400
        assert "File too large" in resp.json()["detail"]

    @pytest.mark.asyncio
    @patch("app.api.routes.process_document")
    async def test_evaluate_exception(self, mock_process):
        mock_process.side_effect = Exception("Some evaluation error")
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate",
                files={"file": ("test.txt", b"Some valid content here.", "text/plain")},
            )
        assert resp.status_code == 500
        assert "evaluation failed" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    @patch("app.api.routes.process_document")
    async def test_rejects_insufficient_text(self, mock_process):
        mock_process.return_value = ProcessedDocument(
            metadata=DocumentMetadata(filename="test.txt", format="txt"),
            full_text="too short",
            chunks=[],
        )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate",
                files={"file": ("test.txt", b"too short", "text/plain")},
            )
        assert resp.status_code == 400
        assert "sufficient text" in resp.json()["detail"]

    @pytest.mark.asyncio
    @patch("app.api.routes.get_repository")
    @patch("app.api.routes.get_storage_backend")
    @patch("app.api.routes.AgentOrchestrator")
    @patch("app.api.routes.process_document")
    async def test_successful_evaluation(self, mock_process, mock_orch_cls, mock_storage_fn, mock_repo_fn):
        long_text = " ".join(["word"] * 50)
        mock_process.return_value = ProcessedDocument(
            metadata=make_metadata(),
            full_text=long_text,
            chunks=[make_chunk(text=long_text)],
            summary="Test summary.",
        )

        # Build final evaluation pydantic model
        final_eval = FinalEvaluation(
            overall_score=70,
            recommendation="Recommended",
            summary="Good proposal",
            risk_level="Low",
            swot_analysis={"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
            parameter_breakdown={},
        )

        mock_orch = MagicMock()
        mock_orch.evaluate = AsyncMock(return_value=EvaluationResponse(
            status="success",
            document_metadata=make_metadata(),
            evaluation=final_eval,
            agent_results={},
            processing_time_seconds=2.5,
        ))
        mock_orch_cls.return_value = mock_orch

        # Mock storage
        mock_storage = AsyncMock()
        mock_storage.upload.return_value = "http://storage/test.pdf"
        mock_storage_fn.return_value = mock_storage

        # Mock repo
        mock_repo = AsyncMock()
        mock_repo.save_evaluation.return_value = "eval-id-123"
        mock_repo_fn.return_value = mock_repo

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate",
                files={"file": ("test.txt", long_text.encode(), "text/plain")},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert "evaluation" in data
        assert "processing_time_seconds" in data
        assert data["evaluation_id"] == "eval-id-123"
        assert data["file_url"] == "http://storage/test.pdf"


# ============================================================================
# Evaluate chunks endpoint
# ============================================================================

class TestEvaluateChunksEndpoint:
    @pytest.mark.asyncio
    async def test_rejects_empty_chunks(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate-chunks",
                json={
                    "chunks": [],
                    "metadata": {"filename": "t.pdf", "format": "pdf"},
                },
            )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    @patch("app.api.routes.AgentOrchestrator")
    async def test_successful_chunk_evaluation(self, mock_orch_cls):
        final_eval = FinalEvaluation(
            overall_score=60,
            recommendation="Conditionally Recommended",
            swot_analysis={"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
            parameter_breakdown={},
        )
        mock_orch = MagicMock()
        mock_orch.evaluate = AsyncMock(return_value=EvaluationResponse(
            status="success",
            document_metadata=make_metadata(),
            evaluation=final_eval,
            agent_results={},
            processing_time_seconds=2.0,
        ))
        mock_orch_cls.return_value = mock_orch

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate-chunks",
                json={
                    "chunks": [{"chunk_id": "c1", "text": "test content"}],
                    "metadata": {"filename": "t.pdf", "format": "pdf"},
                    "summary": "Test summary",
                },
            )
        assert resp.status_code == 200


# ============================================================================
# Reports endpoints
# ============================================================================

class TestReportsEndpoints:
    @pytest.mark.asyncio
    @patch("app.api.routes.get_repository")
    async def test_list_reports(self, mock_repo_fn):
        mock_repo = AsyncMock()
        mock_repo.list_evaluations.return_value = {
            "evaluations": [{"id": "1", "filename": "a.pdf", "overall_score": 80}],
            "total": 1,
            "page": 1,
            "limit": 20,
            "total_pages": 1,
        }
        mock_repo_fn.return_value = mock_repo

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/reports")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert len(data["evaluations"]) == 1

    @pytest.mark.asyncio
    @patch("app.api.routes.get_repository")
    async def test_get_report_found(self, mock_repo_fn):
        mock_repo = AsyncMock()
        mock_repo.get_evaluation.return_value = {
            "id": "abc-123",
            "filename": "test.pdf",
            "overall_score": 75.0,
            "evaluation_report": {"evaluation": {}},
        }
        mock_repo_fn.return_value = mock_repo

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/reports/abc-123")
        assert resp.status_code == 200
        assert resp.json()["data"]["id"] == "abc-123"

    @pytest.mark.asyncio
    @patch("app.api.routes.get_repository")
    async def test_get_report_not_found(self, mock_repo_fn):
        mock_repo = AsyncMock()
        mock_repo.get_evaluation.return_value = None
        mock_repo_fn.return_value = mock_repo

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/reports/nonexistent")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    @patch("app.api.routes.get_storage_backend")
    @patch("app.api.routes.get_repository")
    async def test_delete_report(self, mock_repo_fn, mock_storage_fn):
        mock_repo = AsyncMock()
        mock_repo.get_evaluation.return_value = {
            "id": "del-id",
            "file_storage_key": "proposals/key.pdf",
        }
        mock_repo.delete_evaluation.return_value = True
        mock_repo_fn.return_value = mock_repo

        mock_storage = AsyncMock()
        mock_storage_fn.return_value = mock_storage

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.delete("/api/v1/reports/del-id")
        assert resp.status_code == 200
        assert resp.json()["status"] == "success"

    @pytest.mark.asyncio
    @patch("app.api.routes.get_repository")
    async def test_delete_report_not_found(self, mock_repo_fn):
        mock_repo = AsyncMock()
        mock_repo.get_evaluation.return_value = None
        mock_repo_fn.return_value = mock_repo

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.delete("/api/v1/reports/nonexistent")
        assert resp.status_code == 404


# ============================================================================
# Compare endpoint
# ============================================================================

class TestCompareEndpoint:
    @pytest.mark.asyncio
    @patch("app.api.routes.get_repository")
    async def test_compare_reports(self, mock_repo_fn):
        mock_repo = AsyncMock()
        mock_repo.get_evaluations_by_ids.return_value = [
            {
                "id": "id1",
                "filename": "a.pdf",
                "overall_score": 70.0,
                "recommendation": "Recommended",
                "evaluation_report": {"evaluation": {"overall_score": 70}},
            },
            {
                "id": "id2",
                "filename": "b.pdf",
                "overall_score": 85.0,
                "recommendation": "Highly Recommended",
                "evaluation_report": {"evaluation": {"overall_score": 85}},
            },
        ]
        mock_repo_fn.return_value = mock_repo

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/reports/compare",
                json={"report_ids": ["id1", "id2"]},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["reports"]) == 2
        assert "comparison" in data
        assert data["comparison"]["total_reports"] == 2
        assert len(data["comparison"]["ranking"]) == 2
        # b.pdf should be ranked first (higher score)
        assert data["comparison"]["ranking"][0]["filename"] == "b.pdf"

    @pytest.mark.asyncio
    @patch("app.api.routes.get_repository")
    async def test_compare_insufficient_reports(self, mock_repo_fn):
        mock_repo = AsyncMock()
        mock_repo.get_evaluations_by_ids.return_value = [
            {"id": "id1", "filename": "a.pdf", "overall_score": 70.0},
        ]
        mock_repo_fn.return_value = mock_repo

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/reports/compare",
                json={"report_ids": ["id1", "id2"]},
            )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_compare_requires_min_2_ids(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/reports/compare",
                json={"report_ids": ["id1"]},
            )
        assert resp.status_code == 422  # Pydantic validation (min_length=2)


# ============================================================================
# Batch endpoint
# ============================================================================

class TestBatchEndpoint:
    @pytest.mark.asyncio
    @patch("app.api.routes.process_batch")
    async def test_batch_evaluation(self, mock_batch):
        mock_batch.return_value = {
            "batch_id": "batch-001",
            "total_files": 2,
            "completed": 2,
            "failed": 0,
            "results": [
                {"evaluation_id": "e1", "filename": "a.pdf", "status": "completed"},
                {"evaluation_id": "e2", "filename": "b.pdf", "status": "completed"},
            ],
        }

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate-batch",
                files=[
                    ("files", ("a.pdf", b"content_a", "application/pdf")),
                    ("files", ("b.pdf", b"content_b", "application/pdf")),
                ],
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["batch_id"] == "batch-001"
        assert data["total_files"] == 2

    @pytest.mark.asyncio
    async def test_batch_rejects_empty(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/v1/evaluate-batch")
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_batch_rejects_unsupported_format(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/evaluate-batch",
                files=[("files", ("test.exe", b"content", "application/octet-stream"))],
            )
        assert resp.status_code == 400


# ============================================================================
# Get batch endpoint
# ============================================================================

class TestGetBatchEndpoint:
    @pytest.mark.asyncio
    @patch("app.api.routes.get_repository")
    async def test_get_batch(self, mock_repo_fn):
        mock_repo = AsyncMock()
        mock_repo.get_evaluations_by_batch.return_value = [
            {"id": "e1", "filename": "a.pdf", "status": "completed", "batch_id": "b1"},
            {"id": "e2", "filename": "b.pdf", "status": "completed", "batch_id": "b1"},
        ]
        mock_repo_fn.return_value = mock_repo

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/batches/b1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["batch_id"] == "b1"
        assert data["total_files"] == 2

    @pytest.mark.asyncio
    @patch("app.api.routes.get_repository")
    async def test_get_batch_not_found(self, mock_repo_fn):
        mock_repo = AsyncMock()
        mock_repo.get_evaluations_by_batch.return_value = []
        mock_repo_fn.return_value = mock_repo

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/batches/nonexistent")
        assert resp.status_code == 404
