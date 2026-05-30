"""
Shared test fixtures for the AgriEval Python service test suite.
Provides mock LLM clients, sample document data, and reusable factories.
"""

import os
import pytest
from unittest.mock import MagicMock, patch

from app.models.enums import ChunkPosition, ChunkType
from app.models.schemas import (
    AgentResult,
    DocumentChunk,
    DocumentMetadata,
    EvidenceItem,
    ExtractedImage,
    ExtractedTable,
    FinalEvaluation,
    ProcessedDocument,
    SWOTAnalysis,
)


# ---------------------------------------------------------------------------
# Environment — set a dummy GROQ_API_KEY before any app code imports Settings
# ---------------------------------------------------------------------------
os.environ.setdefault("GROQ_API_KEY", "test-key-for-unit-tests")


# ---------------------------------------------------------------------------
# Sample data factories
# ---------------------------------------------------------------------------


def make_chunk(
    text: str = "Sample proposal chunk text.",
    section_title: str = "Introduction",
    page_numbers: list[int] | None = None,
    chunk_type: ChunkType = ChunkType.TEXT,
    has_financial: bool = False,
    has_technical: bool = False,
    position: ChunkPosition = ChunkPosition.MIDDLE,
    chunk_id: str = "test-chunk-1",
) -> DocumentChunk:
    """Factory for creating test DocumentChunks."""
    return DocumentChunk(
        chunk_id=chunk_id,
        text=text,
        section_title=section_title,
        page_numbers=page_numbers or [1],
        chunk_type=chunk_type,
        word_count=len(text.split()),
        has_financial_data=has_financial,
        has_technical_content=has_technical,
        position=position,
    )


def make_metadata(
    filename: str = "test_proposal.pdf",
    fmt: str = "pdf",
    pages: int = 5,
    words: int = 3000,
) -> DocumentMetadata:
    """Factory for creating test DocumentMetadata."""
    return DocumentMetadata(
        filename=filename,
        format=fmt,
        file_size_bytes=50000,
        total_pages=pages,
        total_words=words,
        total_chunks=3,
        total_images=1,
        total_tables=1,
        detected_sections=["Introduction", "Solution", "Financials"],
    )


def make_table(
    index: int = 0,
    page: int | None = 1,
    raw_text: str = "Revenue: $1M | Cost: $500K",
) -> ExtractedTable:
    return ExtractedTable(
        table_index=index,
        page_number=page,
        headers=["Metric", "Value"],
        rows=[["Revenue", "$1M"], ["Cost", "$500K"]],
        raw_text=raw_text,
    )


def make_image(
    index: int = 0,
    page: int | None = 1,
    ocr_text: str = "Architecture diagram showing microservices",
) -> ExtractedImage:
    return ExtractedImage(
        image_index=index,
        page_number=page,
        ocr_text=ocr_text,
        width=800,
        height=600,
        format="png",
    )


def make_agent_result(
    name: str = "TestAgent",
    score: float = 75.0,
    status: str = "success",
) -> AgentResult:
    return AgentResult(
        agent_name=name,
        score=score,
        confidence=0.85,
        analysis="Test analysis content",
        key_findings=["Finding 1", "Finding 2"],
        red_flags=["Red flag 1"],
        recommendations=["Recommendation 1"],
        raw_output={"score": score, "confidence": 0.85},
        tokens_used=500,
        duration_ms=1000,
        status=status,
        evidence=[],
        warnings=[],
        missing_information=[],
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_chunk():
    return make_chunk()


@pytest.fixture
def sample_chunks():
    return [
        make_chunk(
            text="Our startup solves the problem of food waste in supply chains using IoT sensors and AI.",
            section_title="Problem Statement",
            page_numbers=[1],
            position=ChunkPosition.START,
            chunk_id="chunk-1",
        ),
        make_chunk(
            text="The platform uses cloud architecture with microservices, deployed on Kubernetes. "
            "Our proprietary algorithm processes sensor data in real-time.",
            section_title="Technical Architecture",
            page_numbers=[2, 3],
            has_technical=True,
            chunk_type=ChunkType.TECHNICAL_CONTENT,
            chunk_id="chunk-2",
        ),
        make_chunk(
            text="Revenue model: SaaS subscription at $99/month per farm. "
            "TAM: $5B, SAM: $500M. Projected ARR: $2M by Year 2. CAC: $50, LTV: $1200.",
            section_title="Financial Projections",
            page_numbers=[4, 5],
            has_financial=True,
            chunk_type=ChunkType.FINANCIAL_DATA,
            position=ChunkPosition.END,
            chunk_id="chunk-3",
        ),
    ]


@pytest.fixture
def sample_metadata():
    return make_metadata()


@pytest.fixture
def sample_table():
    return make_table()


@pytest.fixture
def sample_image():
    return make_image()


@pytest.fixture
def mock_llm_response():
    """Returns a factory to create mock LLM responses."""

    def _make(result: dict | None = None, tokens: int = 500, duration_ms: int = 1000):
        return {
            "result": result or {"score": 75, "confidence": 0.85, "analysis": "Mock analysis"},
            "tokens": tokens,
            "duration_ms": duration_ms,
            "raw_text": '{"score": 75}',
        }

    return _make


@pytest.fixture
def mock_llm_client(mock_llm_response):
    """Creates a mock LLM client that returns predictable responses."""
    client = MagicMock()
    client.chat.return_value = mock_llm_response()
    return client
