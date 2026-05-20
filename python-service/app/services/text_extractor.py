"""
Text extraction from various document formats:
- PDF (text-based and mixed)
- DOCX / DOC
- PPTX / PPT
- TXT
- Images (delegates to OCR engine)

Uses PyMuPDF for PDF, python-docx for DOCX, python-pptx for PPTX.
"""

import io
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from docx import Document as DocxDocument
from pptx import Presentation

from app.utils.logging import get_logger
from app.utils.text_cleaning import clean_text

logger = get_logger(__name__)


def extract_text_from_pdf(file_path: Optional[str] = None, file_bytes: Optional[bytes] = None) -> dict:
    """
    Extract text from a PDF file, page by page.

    Args:
        file_path: Path to PDF file.
        file_bytes: Raw bytes of the PDF.

    Returns:
        Dict with keys: text, pages (list of page texts), page_count, has_images
    """
    if file_bytes:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    elif file_path:
        doc = fitz.open(file_path)
    else:
        raise ValueError("Either file_path or file_bytes must be provided")

    pages: list[dict] = []
    full_text_parts: list[str] = []
    has_images = False

    try:
        for page_num in range(len(doc)):
            page = doc[page_num]

            # Extract text
            page_text = page.get_text("text")
            cleaned = clean_text(page_text)

            # Check for images on this page
            image_list = page.get_images(full=True)
            if image_list:
                has_images = True

            pages.append({
                "page_number": page_num + 1,
                "text": cleaned,
                "word_count": len(cleaned.split()),
                "has_images": bool(image_list),
                "image_count": len(image_list),
            })
            full_text_parts.append(cleaned)
    finally:
        doc.close()

    full_text = "\n\n".join(full_text_parts)

    logger.info(
        "pdf_extracted",
        page_count=len(pages),
        word_count=len(full_text.split()),
        has_images=has_images,
    )

    return {
        "text": full_text,
        "pages": pages,
        "page_count": len(pages),
        "has_images": has_images,
    }


def extract_text_from_docx(file_path: Optional[str] = None, file_bytes: Optional[bytes] = None) -> dict:
    """
    Extract text from a DOCX file, preserving paragraph structure.

    Returns:
        Dict with keys: text, paragraphs, has_images, table_count
    """
    if file_bytes:
        doc = DocxDocument(io.BytesIO(file_bytes))
    elif file_path:
        doc = DocxDocument(file_path)
    else:
        raise ValueError("Either file_path or file_bytes must be provided")

    paragraphs: list[dict] = []
    full_text_parts: list[str] = []

    for i, para in enumerate(doc.paragraphs):
        text = para.text.strip()
        if text:
            style_name = para.style.name if para.style else ""
            is_heading = "Heading" in style_name or "Title" in style_name
            paragraphs.append({
                "index": i,
                "text": text,
                "style": style_name,
                "is_heading": is_heading,
            })
            full_text_parts.append(text)

    # Extract text from tables
    table_texts: list[str] = []
    for table in doc.tables:
        table_text_parts: list[str] = []
        for row in table.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
            if row_text:
                table_text_parts.append(row_text)
        if table_text_parts:
            table_texts.append("\n".join(table_text_parts))
            full_text_parts.append("\n".join(table_text_parts))

    # Check for images
    has_images = False
    for rel in doc.part.rels.values():
        if "image" in rel.reltype:
            has_images = True
            break

    full_text = clean_text("\n\n".join(full_text_parts))

    logger.info(
        "docx_extracted",
        paragraph_count=len(paragraphs),
        word_count=len(full_text.split()),
        table_count=len(doc.tables),
        has_images=has_images,
    )

    return {
        "text": full_text,
        "paragraphs": paragraphs,
        "has_images": has_images,
        "table_count": len(doc.tables),
    }


def extract_text_from_pptx(file_path: Optional[str] = None, file_bytes: Optional[bytes] = None) -> dict:
    """
    Extract text from a PPTX file, slide by slide.

    Returns:
        Dict with keys: text, slides, slide_count, has_images
    """
    if file_bytes:
        prs = Presentation(io.BytesIO(file_bytes))
    elif file_path:
        prs = Presentation(file_path)
    else:
        raise ValueError("Either file_path or file_bytes must be provided")

    slides: list[dict] = []
    full_text_parts: list[str] = []
    has_images = False

    for slide_num, slide in enumerate(prs.slides, 1):
        slide_texts: list[str] = []
        slide_has_images = False

        for shape in slide.shapes:
            if shape.has_text_frame:
                for paragraph in shape.text_frame.paragraphs:
                    text = paragraph.text.strip()
                    if text:
                        slide_texts.append(text)

            # Check for tables in slides
            if shape.has_table:
                table = shape.table
                for row in table.rows:
                    row_text = " | ".join(
                        cell.text.strip() for cell in row.cells if cell.text.strip()
                    )
                    if row_text:
                        slide_texts.append(row_text)

            # Check for images
            if shape.shape_type == 13:  # Picture
                slide_has_images = True
                has_images = True

        slide_text = "\n".join(slide_texts)
        slides.append({
            "slide_number": slide_num,
            "text": slide_text,
            "word_count": len(slide_text.split()),
            "has_images": slide_has_images,
        })
        if slide_text:
            full_text_parts.append(f"--- Slide {slide_num} ---\n{slide_text}")

    full_text = clean_text("\n\n".join(full_text_parts))

    logger.info(
        "pptx_extracted",
        slide_count=len(slides),
        word_count=len(full_text.split()),
        has_images=has_images,
    )

    return {
        "text": full_text,
        "slides": slides,
        "slide_count": len(slides),
        "has_images": has_images,
    }


def extract_text_from_txt(file_path: Optional[str] = None, file_bytes: Optional[bytes] = None) -> dict:
    """
    Extract text from a plain text file.

    Returns:
        Dict with keys: text
    """
    if file_bytes:
        text = file_bytes.decode("utf-8", errors="replace")
    elif file_path:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    else:
        raise ValueError("Either file_path or file_bytes must be provided")

    text = clean_text(text)

    logger.info("txt_extracted", word_count=len(text.split()))

    return {
        "text": text,
    }


def extract_text(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    file_type: str = "",
    filename: str = "",
) -> dict:
    """
    Unified text extraction entry point. Routes to the correct extractor
    based on file type/extension.

    Args:
        file_path: Path to the file.
        file_bytes: Raw file bytes.
        file_type: MIME type of the file.
        filename: Original filename (used for extension detection).

    Returns:
        Dict with extracted content.
    """
    # Determine format from MIME type or extension
    ext = ""
    if filename:
        ext = Path(filename).suffix.lower().lstrip(".")
    if not ext and file_path:
        ext = Path(file_path).suffix.lower().lstrip(".")

    mime_to_ext = {
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/msword": "doc",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
        "application/vnd.ms-powerpoint": "ppt",
        "text/plain": "txt",
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/tiff": "tiff",
        "image/bmp": "bmp",
    }

    if not ext and file_type:
        ext = mime_to_ext.get(file_type, "")

    logger.info("extracting_text", format=ext, filename=filename)

    if ext == "pdf":
        return extract_text_from_pdf(file_path=file_path, file_bytes=file_bytes)
    elif ext in ("docx", "doc"):
        return extract_text_from_docx(file_path=file_path, file_bytes=file_bytes)
    elif ext in ("pptx", "ppt"):
        return extract_text_from_pptx(file_path=file_path, file_bytes=file_bytes)
    elif ext == "txt":
        return extract_text_from_txt(file_path=file_path, file_bytes=file_bytes)
    elif ext in ("png", "jpg", "jpeg", "tiff", "bmp"):
        # Image files — delegate to OCR
        return {"text": "", "requires_ocr": True}
    else:
        raise ValueError(f"Unsupported file format: {ext or file_type}")
