"""
SQLAlchemy async models for the evaluations table.
"""

from datetime import datetime, timezone

from sqlalchemy import (
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
    status = Column(String(50), default="pending")  # pending | processing | completed | failed
    error_message = Column(Text, nullable=True)

    # Batch grouping
    batch_id = Column(String(36), nullable=True, index=True)

    # Timestamps
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    completed_at = Column(DateTime, nullable=True)
