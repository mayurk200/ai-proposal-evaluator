"""
Document processing pipeline: extract -> OCR -> tables -> images -> sections.

Rewritten to stop blocking the event loop and to stop doing the same work twice.

Previously, `extract_images_from_file` and `extract_tables_from_file` were called
synchronously from an `async` function, so they ran *on the event loop* — a 14-page
PDF's table extraction froze health checks, the proposals list, and every other
in-flight request for its whole duration. Scanned-PDF OCR was worse: it looped
page-by-page, re-opening the PDF from bytes for every single page, also on the loop.

Now the three independent extraction passes (images, tables, and page OCR when
needed) run concurrently in threads, and the document is opened once.

Chunking is gone from this layer. The old chunker cut the document into overlapping
2000-token windows and then every agent keyword-scanned all of them. Sections replace
that: the document is cut on its real headings, each part is labelled, and each agent
receives only its own sections. See sectioniser.py.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Optional

from app.models.schemas import DocumentMetadata, ExtractedFormFields, ProcessedDocument
from app.services.extraction.form_field_extractor import extract_form_fields
from app.services.extraction.image_extractor import extract_images_from_file
from app.services.extraction.table_extractor import extract_tables_from_file
from app.services.extraction.text_extractor import extract_text
from app.services.ocr.ocr_engine import is_scanned_pdf, ocr_image, ocr_pdf_pages
from app.services.processing.sectioniser import (
    Section,
    sectionise,
    sections_to_json,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)

IMAGE_FORMATS = ("png", "jpg", "jpeg", "tiff", "bmp")


async def process_document(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    filename: str = "",
    file_type: str = "",
    run_ocr: bool = True,
) -> ProcessedDocument:
    """
    Run the full extraction pipeline.

    Returns a ProcessedDocument carrying the full text, the labelled sections, the
    tables, the images and the regex-extracted form fields. Makes no LLM calls —
    metadata and evaluation are separate stages, so re-running extraction is free.
    """
    start = time.time()

    ext = ""
    if filename:
        ext = Path(filename).suffix.lower().lstrip(".")
    if not ext and file_path:
        ext = Path(file_path).suffix.lower().lstrip(".")

    logger.info("processing_document", filename=filename, format=ext)

    file_size = len(file_bytes) if file_bytes else (
        Path(file_path).stat().st_size if file_path else 0
    )

    is_image = ext in IMAGE_FORMATS

    # ------------------------------------------------------------------
    # Text (+ OCR when the document is a scan)
    # ------------------------------------------------------------------
    if is_image:
        full_text, page_count, has_scanned = await _process_image_file(
            file_path=file_path, file_bytes=file_bytes, run_ocr=run_ocr
        )
        images, tables = [], []
    else:
        text_result = await asyncio.to_thread(
            extract_text,
            file_path=file_path,
            file_bytes=file_bytes,
            file_type=file_type,
            filename=filename,
        )
        full_text = text_result.get("text", "")
        page_count = text_result.get("page_count", 1)
        has_scanned = False

        # The three passes below are independent of one another, and all three are
        # CPU-bound. Run them together rather than end to end.
        ocr_task = None
        if ext == "pdf" and run_ocr:
            scanned = await asyncio.to_thread(
                is_scanned_pdf, pdf_path=file_path, pdf_bytes=file_bytes
            )
            if scanned:
                has_scanned = True
                logger.info("scanned_pdf_detected", pages=page_count)
                ocr_task = ocr_pdf_pages(pdf_bytes=file_bytes, pdf_path=file_path)

        images_task = asyncio.to_thread(
            extract_images_from_file,
            file_path=file_path,
            file_bytes=file_bytes,
            filename=filename,
            run_ocr=run_ocr,
        )
        tables_task = asyncio.to_thread(
            extract_tables_from_file,
            file_path=file_path,
            file_bytes=file_bytes,
            filename=filename,
        )

        results = await asyncio.gather(
            images_task,
            tables_task,
            ocr_task if ocr_task else _noop(),
            return_exceptions=True,
        )

        images = _unwrap(results[0], "image_extraction", default=[])
        tables = _unwrap(results[1], "table_extraction", default=[])
        ocr_by_page = _unwrap(results[2], "pdf_ocr", default={}) or {}

        if ocr_by_page:
            ocr_text = "\n\n".join(
                ocr_by_page[page] for page in sorted(ocr_by_page)
            )
            full_text = (
                f"{full_text}\n\n[OCR Content]\n{ocr_text}"
                if full_text.strip()
                else ocr_text
            )

    logger.info("text_extracted", words=len(full_text.split()), pages=page_count)

    # ------------------------------------------------------------------
    # Form fields (regex — zero token cost) and sections (embeddings — zero token cost)
    # ------------------------------------------------------------------
    form_fields = await _extract_form_fields(full_text)

    sections: dict[str, Section] = {}
    if full_text.strip():
        try:
            sections = await sectionise(full_text)
        except Exception as exc:
            # Sectioning failing must not lose the document. Without sections the
            # agents fall back to whole-document context — worse and pricier, but
            # not broken.
            logger.error("sectionise_failed", error=str(exc))

    elapsed = time.time() - start

    metadata = DocumentMetadata(
        filename=filename or (Path(file_path).name if file_path else "unknown"),
        format=ext,
        file_size_bytes=file_size,
        total_pages=page_count,
        total_words=len(full_text.split()),
        total_chunks=len(sections),
        total_images=len(images),
        total_tables=len(tables),
        has_scanned_content=has_scanned,
        detected_sections=sorted(sections.keys()),
        processing_time_seconds=round(elapsed, 2),
    )

    logger.info(
        "document_processed",
        filename=filename,
        pages=page_count,
        words=len(full_text.split()),
        sections=len(sections),
        images=len(images),
        tables=len(tables),
        scanned=has_scanned,
        seconds=round(elapsed, 2),
    )

    return ProcessedDocument(
        metadata=metadata,
        full_text=full_text,
        sections=sections_to_json(sections),
        images=images,
        tables=tables,
        form_fields=form_fields,
    )


async def _process_image_file(
    *,
    file_path: Optional[str],
    file_bytes: Optional[bytes],
    run_ocr: bool,
) -> tuple[str, int, bool]:
    """An uploaded photo/scan of a document — OCR is the only source of text."""
    if not run_ocr:
        return "", 1, True

    from PIL import Image
    import io

    def _read() -> str:
        if file_bytes:
            image = Image.open(io.BytesIO(file_bytes))
        elif file_path:
            image = Image.open(file_path)
        else:
            raise ValueError("No file provided")
        return ocr_image(image=image)

    text = await asyncio.to_thread(_read)
    return text, 1, True


async def _extract_form_fields(full_text: str) -> Optional[ExtractedFormFields]:
    """Regex extraction of the AIAIC form. Rich structure at zero token cost."""
    if not full_text.strip():
        return None

    try:
        raw = await asyncio.to_thread(extract_form_fields, full_text)
        fields = ExtractedFormFields(
            fields=raw.get("fields", {}),
            tables_found=raw.get("tables_found", []),
            financial_numbers=raw.get("financial_numbers", []),
            team_members=raw.get("team_members", []),
            completeness=raw.get("completeness", 0.0),
            qa_pairs_count=raw.get("qa_pairs_count", 0),
        )
        logger.info(
            "form_fields_extracted",
            fields=len(fields.fields),
            completeness=fields.completeness,
        )
        return fields
    except Exception as exc:
        logger.warning("form_field_extraction_failed", error=str(exc))
        return None


async def _noop():
    return None


def _unwrap(result, stage: str, default):
    """
    `asyncio.gather(return_exceptions=True)` hands back the exception object rather
    than raising. One extraction pass failing (a corrupt embedded image, a table
    parser choking) should cost us that pass, not the document.
    """
    if isinstance(result, BaseException):
        logger.warning(f"{stage}_failed", error=str(result))
        return default
    return result if result is not None else default
