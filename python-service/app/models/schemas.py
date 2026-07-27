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
    """
    Complete result of document processing.

    `sections` replaces the old `chunks` list. Chunking cut the document into
    fixed-size overlapping windows and left every agent to keyword-scan all of
    them; sections cut it on its actual headings and label each part, so an agent
    can be handed exactly the parts it is meant to judge. Shape:

        {section_key: {label, char_count, block_count, headings[], text}}
    """
    metadata: DocumentMetadata
    full_text: str = ""
    sections: dict[str, dict] = Field(default_factory=dict)
    images: list[ExtractedImage] = Field(default_factory=list)
    tables: list[ExtractedTable] = Field(default_factory=list)
    summary: str = ""
    form_fields: Optional[ExtractedFormFields] = None


# =============================================================================
# Agent Result Models
# =============================================================================


class Citation(BaseModel):
    """
    A verbatim quote from the proposal, with where it came from.

    Requirement (b): "as the application evaluates and gives a score to each point,
    it should cite on what basis it has given those scores." A score with no
    citation is an assertion, not an evaluation — and an evaluator cannot audit it,
    challenge it, or defend it to the applicant.
    """
    quote: str                      # Verbatim text from the document. Not paraphrased.
    section: str = ""               # Which section it was found in.
    page: Optional[int] = None      # Page number, when known.


class SubQuestionResult(BaseModel):
    """
    One sub-question within a parameter.

    `score` is deliberately Optional. When the proposal simply does not address a
    question, the honest answer is "no evidence", NOT zero — zero means "they
    addressed it and it was terrible", which is a different and much more damaging
    claim. The old schema could not express the difference, so a silent document
    scored the same as a bad one. `evidence_found=False` carries that distinction
    all the way to the final score, which skips these rather than averaging them in.
    """
    question_id: str = ""
    question: str = ""
    score: Optional[float] = None           # 0-10, or None when unevidenced.
    evidence_found: bool = False
    citations: list[Citation] = Field(default_factory=list)
    justification: str = ""                 # Why this score, given those citations.


class AgentResult(BaseModel):
    """Result from a single evaluation agent."""
    agent_name: str
    parameter_key: str = ""
    score: Optional[float] = None           # 0-100, or None when nothing was evidenced.
    confidence: float = 0.0
    analysis: str = ""
    key_findings: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    sub_questions: list[SubQuestionResult] = Field(default_factory=list)

    # Which sections this agent was actually shown. Makes the routing auditable:
    # if an agent scored badly, we can see whether it was ever given the relevant
    # part of the document.
    sections_seen: list[str] = Field(default_factory=list)
    # True when the router had nothing to give it — the document contains no
    # section covering this parameter at all.
    starved: bool = False

    raw_output: dict[str, Any] = Field(default_factory=dict)
    tokens_used: int = 0
    duration_ms: int = 0
    status: str = "success"                 # success | failed
    error: Optional[str] = None

    @property
    def evidenced_count(self) -> int:
        return sum(1 for sq in self.sub_questions if sq.evidence_found)


class ParameterResult(BaseModel):
    """Parameter-level result, as surfaced in the final report."""
    parameter_name: str
    parameter_key: str = ""
    parameter_score: Optional[float] = None     # 0-100
    weight: float = 0.0

    # Why there is no score, when there is no score. `parameter_score is None` has two
    # completely different causes and they must never be conflated:
    #
    #   "unevidenced" — the proposal genuinely does not address this. A finding about
    #                   the APPLICANT, and a fair one.
    #   "failed"      — our agent errored (rate limit, timeout, bad response). A fact
    #                   about US. Reporting it as "the proposal did not address this"
    #                   would blame the applicant for our outage.
    status: str = "scored"                      # scored | unevidenced | failed
    error: Optional[str] = None
    sub_questions: list[SubQuestionResult] = Field(default_factory=list)
    key_findings: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    sections_seen: list[str] = Field(default_factory=list)
    # How much of this parameter the document actually addressed, 0..1.
    evidence_coverage: float = 0.0


class DebateResult(BaseModel):
    """Result from the debate agent's cross-agent analysis."""
    triggered: bool = False
    trigger_reasons: list[str] = Field(default_factory=list)
    conflicts: list[dict] = Field(default_factory=list)
    debates: list[dict] = Field(default_factory=list)
    adjusted_scores: dict[str, float] = Field(default_factory=dict)
    high_ambiguity_areas: list[str] = Field(default_factory=list)
    confidence: float = 0.0


class SWOTAnalysis(BaseModel):
    """
    SWOT analysis.

    Requirement (c): "as it generates the SWOT summary it should be continued" —
    the old SWOT was four lists of disconnected fragments that stopped mid-thought.
    `narrative` is the continuous prose version: a single readable assessment that
    joins the four quadrants into one argument, which is what an evaluator actually
    reads. The lists remain for the dashboard's quadrant view.
    """
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    opportunities: list[str] = Field(default_factory=list)
    threats: list[str] = Field(default_factory=list)
    narrative: str = ""


class FinalEvaluation(BaseModel):
    """
    The final verdict.

    The nine legacy score fields (innovation/market/agriculture/financial/
    scalability/sustainability/risk/technical/feasibility) are gone. They were a
    lossy projection of the seven real AIAIC parameters, produced only so the old
    Node fallback and the frontend could keep reading their original field names.
    Nothing computed them any more; they were being written as zeros and displayed
    as if meaningful.
    """
    overall_score: float = 0.0

    # The seven AIAIC parameters (0-100). None where the document said nothing at all.
    problem_relevance_score: Optional[float] = None
    solution_readiness_score: Optional[float] = None
    pilot_design_score: Optional[float] = None
    farmer_adoption_score: Optional[float] = None
    scaleup_score: Optional[float] = None
    team_capacity_score: Optional[float] = None
    compliance_score: Optional[float] = None

    recommendation: str = RecommendationLevel.NOT_RECOMMENDED.value
    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    swot_analysis: SWOTAnalysis = Field(default_factory=SWOTAnalysis)
    key_action_items: list[str] = Field(default_factory=list)
    risk_level: str = RiskLevel.MEDIUM.value
    investment_readiness: str = ""

    # Claims the document makes that the evidence does not support.
    unsupported_claims: list[str] = Field(default_factory=list)

    # What the document never addressed. Surfaced explicitly rather than buried as
    # a low score, so an evaluator can tell "they didn't answer" apart from
    # "they answered badly".
    unevidenced_parameters: list[str] = Field(default_factory=list)

    # Parameters WE failed to assess — a rate limit, a timeout, a bad response. These
    # are emphatically NOT the applicant's fault and must never be presented as though
    # the proposal was silent on them. An evaluation carrying any of these is partial
    # and should be retried before anyone is judged on it.
    failed_parameters: list[str] = Field(default_factory=list)

    @property
    def is_partial(self) -> bool:
        """True when at least one parameter could not be assessed by us."""
        return bool(self.failed_parameters)

    # Share of all sub-questions that the document actually answered, 0..1.
    evidence_coverage: float = 0.0

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
    """Response for the full evaluation endpoint."""
    status: str = "success"
    processing_status: ProcessingStatus = ProcessingStatus.COMPLETED
    evaluation: FinalEvaluation
    agent_results: dict[str, AgentResult] = Field(default_factory=dict)
    processing_time_seconds: float = 0.0

    evaluation_id: Optional[str] = None
    proposal_id: Optional[str] = None
    document_metadata: Optional[DocumentMetadata] = None

    # Cost/latency roll-up. Every agent already recorded its own tokens and
    # duration; nothing ever added them up, so there was no way to tell what an
    # evaluation cost or whether an optimisation helped.
    total_tokens: int = 0
    model_used: str = ""


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

