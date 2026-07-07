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
    """Granular status of the document processing pipeline."""
    UPLOADED = "uploaded"
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    EXTRACTING = "extracting"
    OCR_PROCESSING = "ocr_processing"
    TEXT_EXTRACTED = "text_extracted"
    CLEANING_TEXT = "cleaning_text"
    CHUNKING = "chunking"
    SUMMARIZING = "summarizing"
    GENERATING_EMBEDDINGS = "generating_embeddings"
    EVALUATING = "evaluating"
    AI_PROCESSING = "ai_processing"
    JSON_VALIDATION = "json_validation"
    CATEGORIZING = "categorizing"
    CATEGORIZED = "categorized"
    EVALUATED = "evaluated"
    SAVING_METADATA = "saving_metadata"
    COMPLETED = "completed"
    FAILED = "failed"
    PENDING = "pending"  # legacy


class ProcessingFailureStatus(str, Enum):
    """Specific failure modes for a document processing run."""
    UPLOAD_FAILED = "upload_failed"
    DOWNLOAD_FAILED = "download_failed"
    EXTRACTION_FAILED = "extraction_failed"
    OCR_FAILED = "ocr_failed"
    AI_FAILED = "ai_failed"
    JSON_VALIDATION_FAILED = "json_validation_failed"
    DATABASE_FAILED = "database_failed"
    EMBEDDING_FAILED = "embedding_failed"
    STORAGE_FAILED = "storage_failed"
    MANUAL_REVIEW_REQUIRED = "manual_review_required"


class ChunkType(str, Enum):
    """Type of content within a chunk."""
    TEXT = "text"
    TABLE = "table"
    IMAGE_OCR = "image_ocr"
    EXECUTIVE_SUMMARY = "executive_summary"
    FINANCIAL_DATA = "financial_data"
    TECHNICAL_CONTENT = "technical_content"
    FORM_FIELD = "form_field"
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
    PROBLEM_RELEVANCE = "ProblemRelevanceAgent"
    SOLUTION_READINESS = "SolutionReadinessAgent"
    PILOT_DESIGN = "PilotDesignAgent"
    FARMER_ADOPTION = "FarmerAdoptionAgent"
    SCALEUP = "ScaleUpAgent"
    TEAM_CAPACITY = "TeamCapacityAgent"
    COMPLIANCE = "ComplianceAgent"
    DEBATE = "DebateAgent"
    SCORING = "FinalScoringAgent"
