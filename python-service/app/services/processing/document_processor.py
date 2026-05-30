"""
Document processor orchestrator.
Coordinates the full pipeline: extraction → OCR → tables → chunking → summarization.
Hardened with try/except around every stage for graceful degradation.
"""

import time
from pathlib import Path
from typing import Optional

from app.models.schemas import (
    DocumentMetadata,
    ProcessedDocument,
)
from app.services.extraction.text_extractor import extract_text
from app.services.ocr.ocr_engine import is_scanned_pdf, ocr_image, ocr_pdf_page
from app.services.extraction.image_extractor import extract_images_from_file
from app.services.extraction.table_extractor import extract_tables_from_file
from app.services.processing.chunker import chunk_document
from app.services.processing.summarizer import create_executive_summary
from app.utils.logging import get_logger
from app.utils.text_cleaning import assess_text_quality

logger = get_logger(__name__)


async def process_document(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    filename: str = "",
    file_type: str = "",
    run_ocr: bool = True,
    generate_summary: bool = True,
) -> ProcessedDocument:
    """
    Full document processing pipeline with hardened error handling.

    Pipeline:
    1. Extract text from document
    2. If PDF: check if scanned → OCR pages
    3. Extract embedded images → OCR them
    4. Extract tables
    5. Chunk the text with metadata
    6. Generate executive summary

    Each stage is wrapped in try/except for graceful degradation.
    If a stage fails, the pipeline continues with partial results.

    Args:
        file_path: Path to the document file.
        file_bytes: Raw file bytes (for in-memory processing).
        filename: Original filename.
        file_type: MIME type of the file.
        run_ocr: Whether to run OCR on images and scanned content.
        generate_summary: Whether to generate an executive summary.

    Returns:
        ProcessedDocument with all extracted content, chunks, and summary.
    """
    start_time = time.time()

    ext = ""
    if filename:
        ext = Path(filename).suffix.lower().lstrip(".")
    if not ext and file_path:
        ext = Path(file_path).suffix.lower().lstrip(".")

    logger.info("processing_document", filename=filename, format=ext)

    # Determine file size
    file_size = 0
    if file_bytes:
        file_size = len(file_bytes)
    elif file_path:
        try:
            file_size = Path(file_path).stat().st_size
        except OSError as e:
            logger.warning("file_size_check_failed", error=str(e))

    # =========================================================================
    # Step 1: Text Extraction
    # =========================================================================
    is_image_file = ext in ("png", "jpg", "jpeg", "tiff", "bmp")
    has_scanned_content = False
    full_text = ""
    page_count = 0
    ocr_confidences: list[float] = []

    try:
        if is_image_file:
            # Image file — OCR directly
            from PIL import Image
            import io

            if file_bytes:
                img = Image.open(io.BytesIO(file_bytes))
            elif file_path:
                img = Image.open(file_path)
            else:
                raise ValueError("No file provided")

            if run_ocr:
                full_text, confidence = ocr_image(image=img)
                ocr_confidences.append(confidence)
            else:
                full_text = ""
            has_scanned_content = True
            page_count = 1
        else:
            # Document file — extract text
            extraction_result = extract_text(
                file_path=file_path,
                file_bytes=file_bytes,
                file_type=file_type,
                filename=filename,
            )

            full_text = extraction_result.get("text", "")
            page_count = extraction_result.get("page_count", extraction_result.get("slide_count", 1))

            # Check if PDF is scanned and needs OCR
            if ext == "pdf" and run_ocr:
                try:
                    scanned = is_scanned_pdf(pdf_path=file_path, pdf_bytes=file_bytes)
                    if scanned:
                        has_scanned_content = True
                        logger.info("scanned_pdf_detected", pages=page_count)

                        # OCR each page and combine
                        ocr_texts: list[str] = []
                        for page_num in range(page_count):
                            try:
                                page_ocr, page_confidence = ocr_pdf_page(
                                    pdf_path=file_path,
                                    pdf_bytes=file_bytes,
                                    page_number=page_num,
                                )
                                if page_ocr:
                                    ocr_texts.append(page_ocr)
                                    ocr_confidences.append(page_confidence)
                            except Exception as e:
                                logger.warning(
                                    "page_ocr_failed",
                                    page=page_num,
                                    error=str(e)[:200],
                                )

                        if ocr_texts:
                            ocr_full_text = "\n\n".join(ocr_texts)
                            # Merge OCR text with any existing text
                            if full_text.strip():
                                full_text = full_text + "\n\n[OCR Content]\n" + ocr_full_text
                            else:
                                full_text = ocr_full_text
                except Exception as e:
                    logger.warning("scanned_pdf_check_failed", error=str(e)[:200])
    except Exception as e:
        logger.error("text_extraction_failed", error=str(e)[:300], filename=filename)
        # Continue with empty text — downstream will handle gracefully

    # Assess text quality for non-OCR content too
    if full_text and not ocr_confidences:
        text_quality = assess_text_quality(full_text)
        ocr_confidences.append(text_quality)

    logger.info("text_extracted", words=len(full_text.split()), pages=page_count)

    # =========================================================================
    # Step 2: Image Extraction + OCR (wrapped in try/except)
    # =========================================================================
    images = []
    if not is_image_file:
        try:
            images = extract_images_from_file(
                file_path=file_path,
                file_bytes=file_bytes,
                filename=filename,
                run_ocr=run_ocr,
            )
        except Exception as e:
            logger.warning("image_extraction_failed", error=str(e)[:200])
            # Continue without images

    # =========================================================================
    # Step 3: Table Extraction (wrapped in try/except)
    # =========================================================================
    tables = []
    try:
        tables = extract_tables_from_file(
            file_path=file_path,
            file_bytes=file_bytes,
            filename=filename,
        )
    except Exception as e:
        logger.warning("table_extraction_failed", error=str(e)[:200])
        # Continue without tables

    # =========================================================================
    # Step 4: Strategic Chunking
    # =========================================================================
    chunks = []
    try:
        chunks = chunk_document(
            text=full_text,
            tables=tables,
            images=images,
            page_count=page_count,
        )
    except Exception as e:
        logger.error("chunking_failed", error=str(e)[:200])
        # If chunking fails, create a single fallback chunk
        from app.models.schemas import DocumentChunk
        if full_text.strip():
            chunks = [DocumentChunk(
                chunk_id="fallback-chunk",
                text=full_text[:10000],
                section_title="Document Content",
                page_numbers=list(range(1, page_count + 1)),
                word_count=len(full_text.split()),
            )]

    # =========================================================================
    # Step 5: Executive Summary (wrapped in try/except)
    # =========================================================================
    summary = ""
    if generate_summary and full_text.strip():
        try:
            summary_result = await create_executive_summary(chunks)
            summary = summary_result.get("executive_summary", "")
        except Exception as e:
            logger.error("summary_generation_failed", error=str(e)[:200])
            # Non-fatal — continue without summary
            summary = ""

    # =========================================================================
    # Build result
    # =========================================================================
    processing_time = time.time() - start_time

    # Compute average OCR confidence
    avg_ocr_confidence = (
        sum(ocr_confidences) / len(ocr_confidences)
        if ocr_confidences
        else 1.0
    )

    detected_sections = list(dict.fromkeys(
        c.section_title for c in chunks if c.section_title
    ))

    # Flag low OCR quality
    if avg_ocr_confidence < 0.3:
        logger.warning(
            "low_ocr_quality",
            confidence=avg_ocr_confidence,
            filename=filename,
        )
        if "low_ocr_quality" not in detected_sections:
            detected_sections.append("low_ocr_quality")

    metadata = DocumentMetadata(
        filename=filename or (Path(file_path).name if file_path else "unknown"),
        format=ext,
        file_size_bytes=file_size,
        total_pages=page_count,
        total_words=len(full_text.split()),
        total_chunks=len(chunks),
        total_images=len(images),
        total_tables=len(tables),
        has_scanned_content=has_scanned_content,
        detected_sections=detected_sections,
        processing_time_seconds=round(processing_time, 2),
        ocr_confidence=round(avg_ocr_confidence, 2),
    )

    result = ProcessedDocument(
        metadata=metadata,
        full_text=full_text,
        chunks=chunks,
        images=images,
        tables=tables,
        summary=summary,
    )

    logger.info(
        "document_processed",
        filename=filename,
        pages=page_count,
        words=len(full_text.split()),
        chunks=len(chunks),
        images=len(images),
        tables=len(tables),
        ocr_confidence=round(avg_ocr_confidence, 2),
        time_seconds=round(processing_time, 2),
    )

    return result
