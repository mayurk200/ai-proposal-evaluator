"""
Integration tests for app.api.routes — FastAPI endpoints via TestClient.
External services (LLM, OCR) are mocked.
"""

import io
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import AsyncClient, ASGITransport
from app.main import app
from app.models.schemas import (
    DocumentChunk,
    DocumentMetadata,
    ProcessedDocument,
)
from tests.conftest import make_chunk, make_metadata


# ============================================================================
# Health check
# ============================================================================

class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health_ok(self):
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
    @patch("app.api.routes.AgentOrchestrator")
    @patch("app.api.routes.process_document")
    async def test_successful_evaluation(self, mock_process, mock_orch_cls):
        long_text = " ".join(["word"] * 50)
        mock_process.return_value = ProcessedDocument(
            metadata=make_metadata(),
            full_text=long_text,
            chunks=[make_chunk(text=long_text)],
            summary="Test summary.",
        )

        mock_orch = MagicMock()
        mock_orch.evaluate = AsyncMock(return_value={
            "agent_results": {},
            "final_evaluation": {
                "overall_score": 70,
                "recommendation": "Recommended",
                "summary": "Good proposal",
                "risk_level": "Low",
            },
        })
        mock_orch_cls.return_value = mock_orch

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
        mock_orch = MagicMock()
        mock_orch.evaluate = AsyncMock(return_value={
            "agent_results": {},
            "final_evaluation": {
                "overall_score": 60,
                "recommendation": "Conditionally Recommended",
            },
        })
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
