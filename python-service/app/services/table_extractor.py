"""
Table extraction from documents.
Uses PyMuPDF's built-in table detection for PDFs,
and python-docx / python-pptx for other formats.
"""

import io
from pathlib import Path
from typing import Optional

from app.models.schemas import ExtractedTable
from app.utils.logging import get_logger

logger = get_logger(__name__)


def extract_tables_from_pdf(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
) -> list[ExtractedTable]:
    """
    Extract tables from a PDF using PyMuPDF's table finder.

    Args:
        file_path: Path to PDF.
        file_bytes: Raw PDF bytes.

    Returns:
        List of ExtractedTable.
    """
    import fitz

    if file_bytes:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    elif file_path:
        doc = fitz.open(file_path)
    else:
        raise ValueError("Provide file_path or file_bytes")

    tables: list[ExtractedTable] = []
    table_index = 0

    try:
        for page_num in range(len(doc)):
            page = doc[page_num]

            try:
                # PyMuPDF built-in table detection
                page_tables = page.find_tables()

                for tab in page_tables:
                    try:
                        extracted = tab.extract()
                        if not extracted or len(extracted) < 2:
                            continue

                        # First row as headers
                        headers = [str(cell or "").strip() for cell in extracted[0]]
                        rows = []
                        for row_data in extracted[1:]:
                            row = [str(cell or "").strip() for cell in row_data]
                            if any(cell for cell in row):  # Skip empty rows
                                rows.append(row)

                        if not rows:
                            continue

                        # Build raw text representation
                        raw_text_parts = [" | ".join(headers)]
                        for row in rows:
                            raw_text_parts.append(" | ".join(row))
                        raw_text = "\n".join(raw_text_parts)

                        tables.append(
                            ExtractedTable(
                                table_index=table_index,
                                page_number=page_num + 1,
                                headers=headers,
                                rows=rows,
                                raw_text=raw_text,
                            )
                        )
                        table_index += 1

                    except Exception as e:
                        logger.warning(
                            "table_parse_failed",
                            page=page_num + 1,
                            error=str(e),
                        )

            except Exception as e:
                logger.warning(
                    "table_detection_failed",
                    page=page_num + 1,
                    error=str(e),
                )
    finally:
        doc.close()

    logger.info("pdf_tables_extracted", count=len(tables))
    return tables


def extract_tables_from_docx(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
) -> list[ExtractedTable]:
    """
    Extract tables from a DOCX file.
    """
    from docx import Document as DocxDocument

    if file_bytes:
        doc = DocxDocument(io.BytesIO(file_bytes))
    elif file_path:
        doc = DocxDocument(file_path)
    else:
        raise ValueError("Provide file_path or file_bytes")

    tables: list[ExtractedTable] = []

    for idx, table in enumerate(doc.tables):
        try:
            all_rows = []
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                all_rows.append(cells)

            if len(all_rows) < 2:
                continue

            headers = all_rows[0]
            data_rows = [r for r in all_rows[1:] if any(cell for cell in r)]

            raw_text_parts = [" | ".join(headers)]
            for row in data_rows:
                raw_text_parts.append(" | ".join(row))

            tables.append(
                ExtractedTable(
                    table_index=idx,
                    headers=headers,
                    rows=data_rows,
                    raw_text="\n".join(raw_text_parts),
                )
            )
        except Exception as e:
            logger.warning("docx_table_failed", index=idx, error=str(e))

    logger.info("docx_tables_extracted", count=len(tables))
    return tables


def extract_tables_from_pptx(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
) -> list[ExtractedTable]:
    """
    Extract tables from a PPTX file.
    """
    from pptx import Presentation

    if file_bytes:
        prs = Presentation(io.BytesIO(file_bytes))
    elif file_path:
        prs = Presentation(file_path)
    else:
        raise ValueError("Provide file_path or file_bytes")

    tables: list[ExtractedTable] = []
    table_index = 0

    for slide_num, slide in enumerate(prs.slides, 1):
        for shape in slide.shapes:
            if shape.has_table:
                try:
                    table = shape.table
                    all_rows = []
                    for row in table.rows:
                        cells = [cell.text.strip() for cell in row.cells]
                        all_rows.append(cells)

                    if len(all_rows) < 2:
                        continue

                    headers = all_rows[0]
                    data_rows = [r for r in all_rows[1:] if any(cell for cell in r)]

                    raw_text_parts = [" | ".join(headers)]
                    for row in data_rows:
                        raw_text_parts.append(" | ".join(row))

                    tables.append(
                        ExtractedTable(
                            table_index=table_index,
                            page_number=slide_num,
                            headers=headers,
                            rows=data_rows,
                            raw_text="\n".join(raw_text_parts),
                        )
                    )
                    table_index += 1

                except Exception as e:
                    logger.warning(
                        "pptx_table_failed",
                        slide=slide_num,
                        error=str(e),
                    )

    logger.info("pptx_tables_extracted", count=len(tables))
    return tables


def extract_tables_from_file(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    file_type: str = "",
    filename: str = "",
) -> list[ExtractedTable]:
    """
    Unified table extraction entry point.
    """
    ext = ""
    if filename:
        ext = Path(filename).suffix.lower().lstrip(".")
    if not ext and file_path:
        ext = Path(file_path).suffix.lower().lstrip(".")

    if ext == "pdf":
        return extract_tables_from_pdf(file_path=file_path, file_bytes=file_bytes)
    elif ext in ("docx", "doc"):
        return extract_tables_from_docx(file_path=file_path, file_bytes=file_bytes)
    elif ext in ("pptx", "ppt"):
        return extract_tables_from_pptx(file_path=file_path, file_bytes=file_bytes)
    else:
        return []
