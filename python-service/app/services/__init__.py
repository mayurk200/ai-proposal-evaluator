"""
Services package — Document processing, OCR, LLM, and extraction services.

Each service domain lives in its own sub-package for modularity.
Import services from here for a clean public API.
"""

from app.services.llm import get_llm_client
from app.services.extraction import extract_text, extract_images_from_file, extract_tables_from_file
from app.services.ocr import is_scanned_pdf, ocr_image, ocr_pdf_page
from app.services.processing import process_document, chunk_document, create_executive_summary

__all__ = [
    # LLM
    "get_llm_client",
    # Extraction
    "extract_text",
    "extract_images_from_file",
    "extract_tables_from_file",
    # OCR
    "is_scanned_pdf",
    "ocr_image",
    "ocr_pdf_page",
    # Processing
    "process_document",
    "chunk_document",
    "create_executive_summary",
]
