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


class ExtractedFormFields(BaseModel):
    """Structured fields extracted from AIAIC form-based proposals."""
    fields: dict[str, str] = Field(default_factory=dict)
    tables_found: list[dict] = Field(default_factory=list)
    financial_numbers: list[dict] = Field(default_factory=list)
    team_members: list[dict] = Field(default_factory=list)
    completeness: float = 0.0
    qa_pairs_count: int = 0


class ProcessedDocument(BaseModel):
    """Complete result of document processing."""
    metadata: DocumentMetadata
    full_text: str = ""
    chunks: list[DocumentChunk] = Field(default_factory=list)
    images: list[ExtractedImage] = Field(default_factory=list)
    tables: list[ExtractedTable] = Field(default_factory=list)
    summary: str = ""
    form_fields: Optional[ExtractedFormFields] = None


# =============================================================================
# Agent Result Models
# =============================================================================


class SubQuestionResult(BaseModel):
    """Result for a single sub-question within a parameter evaluation."""
    question_id: str = ""
    question: str = ""
    score: float = 0.0  # 0-10 scale
    evidence: str = ""  # Text from proposal supporting score
    justification: str = ""  # Why this score was given
    mapped_fields_found: list[str] = Field(default_factory=list)


class AgentResult(BaseModel):
    """Result from a single evaluation agent."""
    agent_name: str
    score: float = 0.0
    confidence: float = 0.0
    analysis: str = ""
    key_findings: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    sub_questions: list[SubQuestionResult] = Field(default_factory=list)
    raw_output: dict[str, Any] = Field(default_factory=dict)
    tokens_used: int = 0
    duration_ms: int = 0
    status: str = "success"
    error: Optional[str] = None


class ParameterResult(BaseModel):
    """Parameter-level result containing sub-question results."""
    parameter_name: str
    parameter_score: float = 0.0  # 0-100 (avg of sub_questions * 10)
    sub_questions: list[SubQuestionResult] = Field(default_factory=list)
    key_findings: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)


class DebateResult(BaseModel):
    """Result from the debate agent's cross-agent analysis."""
    conflicts: list[dict] = Field(default_factory=list)
    debates: list[dict] = Field(default_factory=list)
    adjusted_scores: dict[str, float] = Field(default_factory=dict)
    high_ambiguity_areas: list[str] = Field(default_factory=list)
    confidence: float = 0.0


class SWOTAnalysis(BaseModel):
    """SWOT analysis structure."""
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    opportunities: list[str] = Field(default_factory=list)
    threats: list[str] = Field(default_factory=list)


class FinalEvaluation(BaseModel):
    """Final evaluation result combining all agent analyses."""
    overall_score: float = 0.0

    # New parameter-aligned scores (0-100)
    problem_relevance_score: float = 0.0
    solution_readiness_score: float = 0.0
    pilot_design_score: float = 0.0
    farmer_adoption_score: float = 0.0
    scaleup_score: float = 0.0
    team_capacity_score: float = 0.0
    compliance_score: float = 0.0

    # Legacy scores (kept for backward compatibility)
    innovation_score: float = 0.0
    market_score: float = 0.0
    agriculture_score: float = 0.0
    financial_score: float = 0.0
    scalability_score: float = 0.0
    sustainability_score: float = 0.0
    risk_score: float = 0.0
    technical_score: float = 0.0
    feasibility_score: float = 0.0

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

    # New structured breakdown
    parameter_breakdown: dict[str, ParameterResult] = Field(default_factory=dict)
    debate_summary: Optional[DebateResult] = None


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
    evaluation_id: Optional[str] = None  # DB record ID (set after persistence)
    file_url: Optional[str] = None       # Storage URL (set after upload)


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


# =============================================================================
# Batch Processing Models
# =============================================================================


class BatchEvaluationResponse(BaseModel):
    """Response for batch evaluation endpoint."""
    status: str = "success"
    batch_id: str
    total_files: int = 0
    completed: int = 0
    failed: int = 0
    results: list[dict] = Field(default_factory=list)


# =============================================================================
# Report & Comparison Models
# =============================================================================


class ReportListResponse(BaseModel):
    """Paginated list of evaluation reports."""
    evaluations: list[dict] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    limit: int = 20
    total_pages: int = 0


class CompareRequest(BaseModel):
    """Request to compare multiple evaluation reports."""
    report_ids: list[str] = Field(..., min_length=2)


class CompareResponse(BaseModel):
    """Response for report comparison."""
    reports: list[dict] = Field(default_factory=list)
    comparison: dict = Field(default_factory=dict)


# =============================================================================
# Categorization (Phase 2: extract -> categorize -> store JSON)
# =============================================================================


class CategorizationFlags(BaseModel):
    """Extensible boolean flags the categorization agent may raise."""
    agri_relevant: bool = True
    needs_review: bool = False
    insufficient_text: bool = False
    out_of_scope: bool = False


class CategorizationResult(BaseModel):
    """
    Structured, all-information record the CategorizationAgent produces from a
    proposal's extracted text. No scoring/evaluation here — that is a later phase.
    """
    title: str = ""
    summary: str = ""
    problem_statement: str = ""
    proposed_solution: str = ""
    technologies: list[str] = Field(default_factory=list)
    target_beneficiaries: list[str] = Field(default_factory=list)
    geography: str = ""
    stage: str = ""  # idea | pilot | scaling
    categories: list[str] = Field(default_factory=list)  # agri-only, may be several
    keywords: list[str] = Field(default_factory=list)
    agri_relevance: bool = True
    rank: int = 0  # 0-100 quick triage rank (NOT the formal evaluation)
    confidence: float = 0.0
    flags: CategorizationFlags = Field(default_factory=CategorizationFlags)


class CategorizeResponse(BaseModel):
    """Response for the async categorization trigger endpoint."""
    status: str = "success"
    proposal_id: str
    processing_status: ProcessingStatus = ProcessingStatus.CATEGORIZING
    deduplicated: bool = False


# =============================================================================
# Ingestion (Step 1: upload -> store -> extract -> manifest)
# =============================================================================


class IngestResponse(BaseModel):
    """Response for the document ingestion endpoint."""
    status: str = "success"
    proposal_id: str
    deduplicated: bool = False
    manifest: dict = Field(default_factory=dict)


class ProposalResponse(BaseModel):
    """Full stored proposal record (including extracted text)."""
    status: str = "success"
    proposal: dict = Field(default_factory=dict)

