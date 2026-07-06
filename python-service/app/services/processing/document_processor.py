"""
Document processor orchestrator.
Coordinates the full pipeline: extraction → OCR → tables → chunking → summarization.

All heavy synchronous work (text extraction, OCR, image/table extraction) is
offloaded to worker threads with asyncio.to_thread so the event loop — and with
it every other request, including health checks — stays responsive.
"""

import asyncio
import time
from pathlib import Path
from typing import Optional

from app.models.schemas import (
    DocumentMetadata,
    ExtractedFormFields,
    ProcessedDocument,
)
from app.services.extraction.text_extractor import extract_text
from app.services.ocr.ocr_engine import is_scanned_pdf, ocr_image, ocr_pdf_page
from app.services.extraction.image_extractor import extract_images_from_file
from app.services.extraction.table_extractor import extract_tables_from_file
from app.services.extraction.form_field_extractor import extract_form_fields
from app.services.processing.chunker import chunk_document
from app.services.processing.summarizer import create_executive_summary
from app.utils.logging import get_logger

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
    Full document processing pipeline.

    Pipeline:
    1. Extract text from document
    2. If PDF: check if scanned → OCR pages
    3. Extract embedded images → OCR them
    4. Extract tables
    5. Chunk the text with metadata
    6. Generate executive summary

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
        file_size = Path(file_path).stat().st_size

    # =========================================================================
    # Step 1: Text Extraction
    # =========================================================================
    is_image_file = ext in ("png", "jpg", "jpeg", "tiff", "bmp")
    has_scanned_content = False
    full_text = ""
    page_count = 0

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

        full_text = await asyncio.to_thread(ocr_image, image=img) if run_ocr else ""
        has_scanned_content = True
        page_count = 1
    else:
        # Document file — extract text
        extraction_result = await asyncio.to_thread(
            extract_text,
            file_path=file_path,
            file_bytes=file_bytes,
            file_type=file_type,
            filename=filename,
        )

        full_text = extraction_result.get("text", "")
        page_count = extraction_result.get("page_count", extraction_result.get("slide_count", 1))

        # Check if PDF is scanned and needs OCR
        if ext == "pdf" and run_ocr:
            scanned = is_scanned_pdf(pdf_path=file_path, pdf_bytes=file_bytes)
            if scanned:
                has_scanned_content = True
                logger.info("scanned_pdf_detected", pages=page_count)

                # OCR each page and combine
                ocr_texts: list[str] = []
                for page_num in range(page_count):
                    page_ocr = ocr_pdf_page(
                        pdf_path=file_path,
                        pdf_bytes=file_bytes,
                        page_number=page_num,
                    )
                    if page_ocr:
                        ocr_texts.append(page_ocr)

                if ocr_texts:
                    ocr_full_text = "\n\n".join(ocr_texts)
                    # Merge OCR text with any existing text
                    if full_text.strip():
                        full_text = full_text + "\n\n[OCR Content]\n" + ocr_full_text
                    else:
                        full_text = ocr_full_text

    logger.info("text_extracted", words=len(full_text.split()), pages=page_count)

    # =========================================================================
    # Step 2: Image Extraction + OCR
    # =========================================================================
    images = []
    if not is_image_file:
        images = extract_images_from_file(
            file_path=file_path,
            file_bytes=file_bytes,
            filename=filename,
            run_ocr=run_ocr,
        )

    # =========================================================================
    # Step 3: Table Extraction
    # =========================================================================
    tables = extract_tables_from_file(
        file_path=file_path,
        file_bytes=file_bytes,
        filename=filename,
    )

    # =========================================================================
    # Step 3.5: Form Field Extraction (AIAIC-specific)
    # =========================================================================
    form_fields_data = None
    if full_text.strip():
        try:
            raw_form = extract_form_fields(full_text)
            form_fields_data = ExtractedFormFields(
                fields=raw_form.get("fields", {}),
                tables_found=raw_form.get("tables_found", []),
                financial_numbers=raw_form.get("financial_numbers", []),
                team_members=raw_form.get("team_members", []),
                completeness=raw_form.get("completeness", 0.0),
                qa_pairs_count=raw_form.get("qa_pairs_count", 0),
            )
            logger.info(
                "form_fields_extracted",
                fields=len(raw_form.get("fields", {})),
                completeness=raw_form.get("completeness", 0.0),
            )
        except Exception as e:
            logger.warning("form_field_extraction_failed", error=str(e))

    # =========================================================================
    # Step 4: Strategic Chunking
    # =========================================================================
    chunks = chunk_document(
        text=full_text,
        tables=tables,
        images=images,
        page_count=page_count,
    )

    # =========================================================================
    # Step 5: Executive Summary
    # =========================================================================
    summary = ""
    if generate_summary and full_text.strip():
        try:
            summary_result = await create_executive_summary(chunks)
            summary = summary_result.get("executive_summary", "")
        except Exception as e:
            logger.error("summary_generation_failed", error=str(e))
            # Non-fatal — continue without summary
            summary = ""

    # =========================================================================
    # Build result
    # =========================================================================
    processing_time = time.time() - start_time

    detected_sections = list(dict.fromkeys(
        c.section_title for c in chunks if c.section_title
    ))

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
    )

    result = ProcessedDocument(
        metadata=metadata,
        full_text=full_text,
        chunks=chunks,
        images=images,
        tables=tables,
        summary=summary,
        form_fields=form_fields_data,
    )

    logger.info(
        "document_processed",
        filename=filename,
        pages=page_count,
        words=len(full_text.split()),
        chunks=len(chunks),
        images=len(images),
        tables=len(tables),
        time_seconds=round(processing_time, 2),
    )

    return result
