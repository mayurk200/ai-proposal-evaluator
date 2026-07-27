"""
Services package — extraction, OCR, embeddings, LLM, processing, storage, database.

Each service domain lives in its own sub-package. Import from here for a clean
public API.
"""

from app.services.embeddings import embed_text, embed_texts
from app.services.extraction import (
    extract_images_from_file,
    extract_tables_from_file,
    extract_text,
)
from app.services.llm import get_llm_client
from app.services.ocr import is_scanned_pdf, ocr_image, ocr_pdf_pages
from app.services.processing import (
    get_ingestion_service,
    process_document,
    scoreable_sections,
    sectionise,
)

__all__ = [
    # LLM
    "get_llm_client",
    # Embeddings
    "embed_text",
    "embed_texts",
    # Extraction
    "extract_text",
    "extract_images_from_file",
    "extract_tables_from_file",
    # OCR
    "is_scanned_pdf",
    "ocr_image",
    "ocr_pdf_pages",
    # Processing
    "process_document",
    "sectionise",
    "scoreable_sections",
    "get_ingestion_service",
]
