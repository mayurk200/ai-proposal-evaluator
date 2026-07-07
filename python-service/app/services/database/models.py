"""
SQLAlchemy async models for the evaluations table.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """SQLAlchemy declarative base."""
    pass


class EvaluationRecord(Base):
    """Persistent record of a document evaluation."""

    __tablename__ = "evaluations"

    id = Column(String(36), primary_key=True)
    filename = Column(String(255), nullable=False)
    file_storage_key = Column(String(512), nullable=True)
    file_storage_url = Column(Text, nullable=True)
    file_size_bytes = Column(Integer, default=0)
    file_content_type = Column(String(100), default="application/octet-stream")

    # Evaluation scores (top-level for efficient queries)
    overall_score = Column(Float, default=0.0)
    recommendation = Column(String(100), default="Not Recommended")

    # Full JSON reports stored as text
    evaluation_report = Column(Text, nullable=True)   # Full EvaluationResponse JSON
    document_metadata = Column(Text, nullable=True)    # DocumentMetadata JSON

    # Status tracking
    status = Column(String(50), default="pending", index=True)  # pending | processing | completed | failed
    error_message = Column(Text, nullable=True)

    # Deduplication + granular processing state
    file_hash = Column(String(64), nullable=True, index=True)  # SHA-256 of the source file
    processing_stage = Column(String(50), nullable=True)       # ProcessingStatus value
    failure_status = Column(String(50), nullable=True)         # ProcessingFailureStatus value
    error_code = Column(String(100), nullable=True)
    retry_count = Column(Integer, default=0)
    worker_id = Column(String(100), nullable=True)

    # Batch grouping
    batch_id = Column(String(36), nullable=True, index=True)

    # Link to the ProposalRecord this evaluation was run for (Phase 2 flow).
    # Nullable: direct /evaluate uploads have no proposal row.
    proposal_id = Column(String(36), nullable=True, index=True)

    # Timestamps
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)


class ProposalRecord(Base):
    """
    Ingested proposal: the original uploaded file, its extracted text, and the
    JSON manifest that indexes everything.

    Step 1 of the pipeline (upload -> store -> extract -> manifest) writes this
    row. Evaluation (agents/scoring) is a later step and lives in
    EvaluationRecord.
    """

    __tablename__ = "proposals"

    id = Column(String(36), primary_key=True)

    # Source file metadata
    filename = Column(String(255), nullable=False)
    document_format = Column(String(20), nullable=True)          # pdf | docx | ...
    file_content_type = Column(String(100), default="application/octet-stream")
    file_size_bytes = Column(Integer, default=0)
    file_hash = Column(String(64), nullable=True, index=True)    # SHA-256 for dedup/search

    # Storage addresses (keys are the stable/authoritative address; URLs may be
    # presigned and time-limited)
    original_key = Column(String(512), nullable=True)
    original_url = Column(Text, nullable=True)
    extracted_key = Column(String(512), nullable=True)
    extracted_url = Column(Text, nullable=True)
    manifest_key = Column(String(512), nullable=True)
    manifest_url = Column(Text, nullable=True)

    # Extracted content (stored in its own column, per requirements)
    extracted_text = Column(Text, nullable=True)
    char_count = Column(Integer, default=0)

    # Extraction stats
    total_pages = Column(Integer, default=0)
    total_words = Column(Integer, default=0)
    total_images = Column(Integer, default=0)
    total_tables = Column(Integer, default=0)
    has_scanned_content = Column(Boolean, default=False)
    detected_sections = Column(Text, nullable=True)              # JSON array

    # Phase 2: source object this row was created from (an already-stored upload,
    # e.g. the Node upload's MinIO key). Lets the upload list exclude processed files.
    source_key = Column(String(512), nullable=True, index=True)
    source_url = Column(Text, nullable=True)

    # Phase 2: categorization output (from the CategorizationAgent)
    categories = Column(Text, nullable=True)        # JSON array of agri category strings
    category_json = Column(Text, nullable=True)     # full CategorizationResult JSON
    rank = Column(Integer, default=0, index=True)   # 0-100 triage rank (not the evaluation)
    agri_relevant = Column(Boolean, default=True)
    categorized_at = Column(DateTime, nullable=True)

    # Status tracking
    status = Column(String(50), default="uploaded", index=True)  # ProcessingStatus value
    error_message = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    extracted_at = Column(DateTime, nullable=True)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        onupdate=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
    )
