"""
Pydantic models for API request/response schemas and internal data structures.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from .enums import (
    ChunkPosition,
    ChunkType,
    ProcessingStatus,
    RecommendationLevel,
    RiskLevel,
)


# =============================================================================
# Document Processing Models
# =============================================================================


class ExtractedImage(BaseModel):
    """An image extracted from a document."""
    image_index: int
    page_number: Optional[int] = None
    ocr_text: str = ""
    width: int = 0
    height: int = 0
    format: str = ""


class ExtractedTable(BaseModel):
    """A table extracted from a document."""
    table_index: int
    page_number: Optional[int] = None
    headers: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)
    raw_text: str = ""


class DocumentChunk(BaseModel):
    """A strategically split chunk of document content with rich metadata."""
    chunk_id: str
    text: str
    section_title: str = ""
    page_numbers: list[int] = Field(default_factory=list)
    chunk_type: ChunkType = ChunkType.TEXT
    word_count: int = 0
    has_financial_data: bool = False
    has_technical_content: bool = False
    tables: list[ExtractedTable] = Field(default_factory=list)
    images: list[ExtractedImage] = Field(default_factory=list)
    position: ChunkPosition = ChunkPosition.MIDDLE
    overlap_with_previous: bool = False


class DocumentMetadata(BaseModel):
    """Metadata about the processed document."""
    filename: str
    format: str
    file_size_bytes: int = 0
    total_pages: int = 0
    total_words: int = 0
    total_chunks: int = 0
    total_images: int = 0
    total_tables: int = 0
    has_scanned_content: bool = False
    detected_sections: list[str] = Field(default_factory=list)
    processing_time_seconds: float = 0.0


class ProcessedDocument(BaseModel):
    """Complete result of document processing."""
    metadata: DocumentMetadata
    full_text: str = ""
    chunks: list[DocumentChunk] = Field(default_factory=list)
    images: list[ExtractedImage] = Field(default_factory=list)
    tables: list[ExtractedTable] = Field(default_factory=list)
    summary: str = ""


# =============================================================================
# Agent Result Models
# =============================================================================


class AgentResult(BaseModel):
    """Result from a single evaluation agent."""
    agent_name: str
    score: float = 0.0
    confidence: float = 0.0
    analysis: str = ""
    key_findings: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    raw_output: dict[str, Any] = Field(default_factory=dict)
    tokens_used: int = 0
    duration_ms: int = 0
    status: str = "success"
    error: Optional[str] = None


class SWOTAnalysis(BaseModel):
    """SWOT analysis structure."""
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    opportunities: list[str] = Field(default_factory=list)
    threats: list[str] = Field(default_factory=list)


class FinalEvaluation(BaseModel):
    """Final evaluation result combining all agent analyses."""
    overall_score: float = 0.0
    problem_relevance_score: float = 0.0
    technical_soundness_score: float = 0.0
    pilot_design_score: float = 0.0
    team_capability_score: float = 0.0
    market_potential_score: float = 0.0
    financial_sustainability_score: float = 0.0
    strategic_impact_score: float = 0.0
    recommendation: str = RecommendationLevel.NOT_RECOMMENDED.value
    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    swot_analysis: SWOTAnalysis = Field(default_factory=SWOTAnalysis)
    key_points: list[str] = Field(default_factory=list)
    invalid_claims: list[str] = Field(default_factory=list)
    investment_readiness: str = ""
    key_action_items: list[str] = Field(default_factory=list)
    risk_level: str = RiskLevel.MEDIUM.value


# =============================================================================
# API Request/Response Models
# =============================================================================


class ProcessDocumentResponse(BaseModel):
    """Response for document processing endpoint."""
    status: str = "success"
    processing_status: ProcessingStatus = ProcessingStatus.COMPLETED
    document: ProcessedDocument


class EvaluationResponse(BaseModel):
    """Response for full evaluation endpoint."""
    status: str = "success"
    processing_status: ProcessingStatus = ProcessingStatus.COMPLETED
    document_metadata: DocumentMetadata
    evaluation: FinalEvaluation
    agent_results: dict[str, AgentResult] = Field(default_factory=dict)
    processing_time_seconds: float = 0.0


class EvaluateChunksRequest(BaseModel):
    """Request for evaluating pre-processed chunks."""
    chunks: list[DocumentChunk]
    metadata: DocumentMetadata
    summary: str = ""


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "ok"
    timestamp: str = Field(default_factory=lambda: datetime.now(tz=__import__("datetime").timezone.utc).isoformat())
    version: str = "1.0.0"
    environment: str = "development"
    services: dict[str, str] = Field(default_factory=dict)


class SupportedFormatsResponse(BaseModel):
    """Response listing supported file formats."""
    formats: list[str]
    max_file_size_mb: int


class ErrorResponse(BaseModel):
    """Standard error response."""
    status: str = "error"
    message: str
    detail: Optional[str] = None
