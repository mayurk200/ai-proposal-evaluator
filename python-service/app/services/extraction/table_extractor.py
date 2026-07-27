"""
Table extraction.

Switched from PyMuPDF's `find_tables()` to pdfplumber. PyMuPDF's finder is fast
but misses tables that lack full ruling lines and frequently merges adjacent
cells. AIAIC application forms are dense ruled tables carrying the budget, the
workplan and the milestones — exactly the numbers the finance and pilot-design
agents are scored against, so mangling them is not a cosmetic problem.

pdfplumber is slower, so callers run it in a thread rather than on the event loop.
(`camelot-py` was declared in requirements but never imported by any code; it is
gone.)
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Optional

from app.models.schemas import ExtractedTable
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _rows_to_table(
    rows: list[list[Optional[str]]], index: int, page_number: Optional[int]
) -> Optional[ExtractedTable]:
    """Normalize a raw grid into an ExtractedTable, dropping empty ones."""
    cleaned: list[list[str]] = []
    for row in rows:
        cells = [(cell or "").strip().replace("\n", " ") for cell in row]
        if any(cells):
            cleaned.append(cells)

    if not cleaned:
        return None

    headers = cleaned[0] if len(cleaned) > 1 else []
    body = cleaned[1:] if len(cleaned) > 1 else cleaned

    # Agents read `raw_text`, so a table that serialises badly is a table the model
    # cannot reason about. Pipe-delimited keeps columns aligned to the row above.
    lines: list[str] = []
    if headers:
        lines.append(" | ".join(headers))
        lines.append("-" * 40)
    lines.extend(" | ".join(row) for row in body)

    return ExtractedTable(
        table_index=index,
        page_number=page_number,
        headers=headers,
        rows=body,
        raw_text="\n".join(lines),
    )


def extract_tables_from_pdf(
    file_path: Optional[str] = None, file_bytes: Optional[bytes] = None
) -> list[ExtractedTable]:
    """Extract tables from a PDF with pdfplumber."""
    import pdfplumber

    source = io.BytesIO(file_bytes) if file_bytes else file_path
    if source is None:
        raise ValueError("Provide file_path or file_bytes")

    tables: list[ExtractedTable] = []

    try:
        with pdfplumber.open(source) as pdf:
            for page_number, page in enumerate(pdf.pages, 1):
                try:
                    # Ruled lines first: application forms are fully ruled, and this
                    # is both the most accurate and the cheapest strategy.
                    found = page.extract_tables()

                    if not found:
                        # Fall back to whitespace alignment, which catches borderless
                        # tables that PyMuPDF would have missed entirely.
                        found = page.extract_tables(
                            {
                                "vertical_strategy": "text",
                                "horizontal_strategy": "text",
                                "intersection_tolerance": 5,
                            }
                        )

                    for rows in found:
                        table = _rows_to_table(rows, len(tables), page_number)
                        if not table:
                            continue
                        # A single-column "table" is almost always a misdetected
                        # paragraph: noise in the agent payload, no information.
                        width = len(table.headers) if table.headers else len(table.rows[0])
                        if width > 1:
                            tables.append(table)

                except Exception as exc:
                    logger.warning(
                        "pdf_table_page_failed", page=page_number, error=str(exc)
                    )

    except Exception as exc:
        logger.warning("pdf_table_extraction_failed", error=str(exc))

    logger.info("pdf_tables_extracted", count=len(tables))
    return tables


def extract_tables_from_docx(
    file_path: Optional[str] = None, file_bytes: Optional[bytes] = None
) -> list[ExtractedTable]:
    from docx import Document as DocxDocument

    doc = DocxDocument(io.BytesIO(file_bytes)) if file_bytes else DocxDocument(file_path)

    tables: list[ExtractedTable] = []
    for i, table in enumerate(doc.tables):
        rows = [[cell.text for cell in row.cells] for row in table.rows]
        extracted = _rows_to_table(rows, i, None)
        if extracted:
            tables.append(extracted)

    logger.info("docx_tables_extracted", count=len(tables))
    return tables


def extract_tables_from_pptx(
    file_path: Optional[str] = None, file_bytes: Optional[bytes] = None
) -> list[ExtractedTable]:
    from pptx import Presentation

    prs = Presentation(io.BytesIO(file_bytes)) if file_bytes else Presentation(file_path)

    tables: list[ExtractedTable] = []
    for slide_num, slide in enumerate(prs.slides, 1):
        for shape in slide.shapes:
            if not shape.has_table:
                continue
            rows = [[cell.text for cell in row.cells] for row in shape.table.rows]
            extracted = _rows_to_table(rows, len(tables), slide_num)
            if extracted:
                tables.append(extracted)

    logger.info("pptx_tables_extracted", count=len(tables))
    return tables


def extract_tables_from_file(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    filename: str = "",
) -> list[ExtractedTable]:
    """Route by extension. A table-extraction failure is never fatal to the pipeline."""
    ext = ""
    if filename:
        ext = Path(filename).suffix.lower().lstrip(".")
    if not ext and file_path:
        ext = Path(file_path).suffix.lower().lstrip(".")

    try:
        if ext == "pdf":
            return extract_tables_from_pdf(file_path=file_path, file_bytes=file_bytes)
        if ext in ("docx", "doc"):
            return extract_tables_from_docx(file_path=file_path, file_bytes=file_bytes)
        if ext in ("pptx", "ppt"):
            return extract_tables_from_pptx(file_path=file_path, file_bytes=file_bytes)
    except Exception as exc:
        logger.warning("table_extraction_failed", format=ext, error=str(exc))

    return []
