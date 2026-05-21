"""
Tests for app.models.schemas — Pydantic model validation, defaults, serialization.
"""

import pytest
from datetime import datetime
from pydantic import ValidationError

from app.models.enums import (
    ChunkPosition,
    ChunkType,
    DocumentFormat,
    ProcessingStatus,
    RecommendationLevel,
    RiskLevel,
    AgentName,
)
from app.models.schemas import (
    AgentResult,
    DocumentChunk,
    DocumentMetadata,
    ErrorResponse,
    EvaluateChunksRequest,
    EvaluationResponse,
    ExtractedImage,
    ExtractedTable,
    FinalEvaluation,
    HealthResponse,
    ProcessDocumentResponse,
    ProcessedDocument,
    SupportedFormatsResponse,
    SWOTAnalysis,
)


# ============================================================================
# Enums
# ============================================================================

class TestEnums:
    def test_document_format_values(self):
        assert DocumentFormat.PDF.value == "pdf"
        assert DocumentFormat.DOCX.value == "docx"
        assert DocumentFormat.PNG.value == "png"

    def test_all_formats_present(self):
        expected = {"pdf", "docx", "doc", "pptx", "ppt", "txt", "png", "jpg", "jpeg", "tiff", "bmp"}
        actual = {f.value for f in DocumentFormat}
        assert actual == expected

    def test_processing_status_flow(self):
        statuses = [s.value for s in ProcessingStatus]
        assert "pending" in statuses
        assert "completed" in statuses
        assert "failed" in statuses

    def test_chunk_type_values(self):
        assert ChunkType.FINANCIAL_DATA.value == "financial_data"
        assert ChunkType.MIXED.value == "mixed"

    def test_recommendation_levels(self):
        assert RecommendationLevel.HIGHLY_RECOMMENDED.value == "Highly Recommended"
        assert RecommendationLevel.NOT_RECOMMENDED.value == "Not Recommended"

    def test_risk_levels(self):
        assert RiskLevel.LOW.value == "Low"
        assert RiskLevel.CRITICAL.value == "Critical"

    def test_agent_names(self):
        assert AgentName.SCORING.value == "FinalScoringAgent"
        assert len(AgentName) == 9


# ============================================================================
# ExtractedImage
# ============================================================================

class TestExtractedImage:
    def test_defaults(self):
        img = ExtractedImage(image_index=0)
        assert img.page_number is None
        assert img.ocr_text == ""
        assert img.width == 0
        assert img.height == 0

    def test_full_creation(self):
        img = ExtractedImage(
            image_index=1,
            page_number=3,
            ocr_text="OCR text",
            width=640,
            height=480,
            format="jpeg",
        )
        assert img.page_number == 3
        assert img.format == "jpeg"

    def test_serialization_roundtrip(self):
        img = ExtractedImage(image_index=0, ocr_text="test")
        data = img.model_dump()
        restored = ExtractedImage(**data)
        assert restored == img


# ============================================================================
# ExtractedTable
# ============================================================================

class TestExtractedTable:
    def test_defaults(self):
        table = ExtractedTable(table_index=0)
        assert table.headers == []
        assert table.rows == []
        assert table.raw_text == ""

    def test_with_data(self):
        table = ExtractedTable(
            table_index=0,
            page_number=2,
            headers=["Metric", "Value"],
            rows=[["Revenue", "$1M"]],
            raw_text="Revenue: $1M",
        )
        assert len(table.rows) == 1
        assert table.headers[0] == "Metric"


# ============================================================================
# DocumentChunk
# ============================================================================

class TestDocumentChunk:
    def test_defaults(self):
        chunk = DocumentChunk(chunk_id="c1", text="content")
        assert chunk.section_title == ""
        assert chunk.page_numbers == []
        assert chunk.chunk_type == ChunkType.TEXT
        assert chunk.position == ChunkPosition.MIDDLE
        assert chunk.has_financial_data is False
        assert chunk.overlap_with_previous is False

    def test_word_count_is_stored(self):
        chunk = DocumentChunk(chunk_id="c1", text="hello world", word_count=2)
        assert chunk.word_count == 2


# ============================================================================
# DocumentMetadata
# ============================================================================

class TestDocumentMetadata:
    def test_defaults(self):
        meta = DocumentMetadata(filename="test.pdf", format="pdf")
        assert meta.total_pages == 0
        assert meta.has_scanned_content is False
        assert meta.detected_sections == []

    def test_full_metadata(self):
        meta = DocumentMetadata(
            filename="proposal.pdf",
            format="pdf",
            file_size_bytes=1024000,
            total_pages=10,
            total_words=5000,
            total_chunks=5,
            total_images=3,
            total_tables=2,
            has_scanned_content=True,
            detected_sections=["Intro", "Solution"],
            processing_time_seconds=2.5,
        )
        assert meta.total_pages == 10
        assert len(meta.detected_sections) == 2


# ============================================================================
# ProcessedDocument
# ============================================================================

class TestProcessedDocument:
    def test_minimal(self):
        doc = ProcessedDocument(
            metadata=DocumentMetadata(filename="t.pdf", format="pdf")
        )
        assert doc.full_text == ""
        assert doc.chunks == []
        assert doc.summary == ""


# ============================================================================
# AgentResult
# ============================================================================

class TestAgentResult:
    def test_defaults(self):
        result = AgentResult(agent_name="TestAgent")
        assert result.score == 0.0
        assert result.status == "success"
        assert result.error is None
        assert result.key_findings == []

    def test_failed_result(self):
        result = AgentResult(
            agent_name="TestAgent",
            status="failed",
            error="Connection timeout",
        )
        assert result.status == "failed"
        assert result.error == "Connection timeout"


# ============================================================================
# FinalEvaluation
# ============================================================================

class TestFinalEvaluation:
    def test_defaults(self):
        evaluation = FinalEvaluation()
        assert evaluation.overall_score == 0.0
        assert evaluation.recommendation == "Not Recommended"
        assert evaluation.risk_level == "Medium"
        assert isinstance(evaluation.swot_analysis, SWOTAnalysis)
        assert evaluation.swot_analysis.strengths == []


# ============================================================================
# API Response Models
# ============================================================================

class TestHealthResponse:
    def test_defaults(self):
        resp = HealthResponse()
        assert resp.status == "ok"
        assert resp.version == "1.0.0"
        # timestamp should be a valid ISO string
        datetime.fromisoformat(resp.timestamp)

    def test_with_services(self):
        resp = HealthResponse(services={"llm": "connected"})
        assert resp.services["llm"] == "connected"


class TestSupportedFormatsResponse:
    def test_creation(self):
        resp = SupportedFormatsResponse(
            formats=["pdf", "docx"],
            max_file_size_mb=50,
        )
        assert len(resp.formats) == 2


class TestErrorResponse:
    def test_creation(self):
        resp = ErrorResponse(message="Something went wrong")
        assert resp.status == "error"
        assert resp.detail is None


class TestEvaluateChunksRequest:
    def test_requires_chunks(self):
        chunk = DocumentChunk(chunk_id="c1", text="test")
        meta = DocumentMetadata(filename="t.pdf", format="pdf")
        req = EvaluateChunksRequest(chunks=[chunk], metadata=meta)
        assert len(req.chunks) == 1
        assert req.summary == ""
