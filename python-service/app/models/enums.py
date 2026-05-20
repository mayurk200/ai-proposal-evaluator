"""
Enumerations for document types, processing statuses, and evaluation categories.
"""

from enum import Enum


class DocumentFormat(str, Enum):
    """Supported document formats."""
    PDF = "pdf"
    DOCX = "docx"
    DOC = "doc"
    PPTX = "pptx"
    PPT = "ppt"
    TXT = "txt"
    PNG = "png"
    JPG = "jpg"
    JPEG = "jpeg"
    TIFF = "tiff"
    BMP = "bmp"


class ProcessingStatus(str, Enum):
    """Status of document processing pipeline."""
    PENDING = "pending"
    EXTRACTING = "extracting"
    CHUNKING = "chunking"
    SUMMARIZING = "summarizing"
    EVALUATING = "evaluating"
    COMPLETED = "completed"
    FAILED = "failed"


class ChunkType(str, Enum):
    """Type of content within a chunk."""
    TEXT = "text"
    TABLE = "table"
    IMAGE_OCR = "image_ocr"
    EXECUTIVE_SUMMARY = "executive_summary"
    FINANCIAL_DATA = "financial_data"
    TECHNICAL_CONTENT = "technical_content"
    MIXED = "mixed"


class ChunkPosition(str, Enum):
    """Position of chunk within the document."""
    START = "start"
    MIDDLE = "middle"
    END = "end"


class RecommendationLevel(str, Enum):
    """Evaluation recommendation levels."""
    HIGHLY_RECOMMENDED = "Highly Recommended"
    RECOMMENDED = "Recommended"
    CONDITIONALLY_RECOMMENDED = "Conditionally Recommended"
    NOT_RECOMMENDED = "Not Recommended"


class RiskLevel(str, Enum):
    """Risk severity levels."""
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"


class AgentName(str, Enum):
    """Names of all evaluation agents."""
    EXTRACTION = "ExtractionAgent"
    TECHNICAL = "TechnicalAgent"
    FINANCIAL = "FinancialAgent"
    RISK = "RiskAgent"
    INNOVATION = "InnovationAgent"
    FEASIBILITY = "FeasibilityAgent"
    COMPLIANCE = "ComplianceAgent"
    SUSTAINABILITY = "SustainabilityAgent"
    SCORING = "FinalScoringAgent"
