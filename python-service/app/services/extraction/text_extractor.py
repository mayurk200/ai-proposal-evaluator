"""
Text extraction with layout awareness.

The previous extractor called `page.get_text("text")`, which returns characters in
the order the PDF happens to store them. For a single-column report that is
usually fine. For the two-column layouts and boxed application forms that AIAIC
proposals actually use, it interleaves columns — you get the first line of the
left column, then the first line of the right column, and the resulting text is
subtly scrambled. Agents then score a document whose sentences do not join up.

What changed:

* PDF text is pulled as positioned blocks and sorted into true reading order
  (top-to-bottom within a column, left column before right).
* Headings are detected from **font size and weight**, not from an ALL-CAPS regex.
  A regex cannot tell a heading from an acronym-heavy sentence; font size can. The
  extracted heading structure is what the sectioniser routes on, so getting this
  right is what lets a finance agent receive the financial section and nothing
  else.
* DOCX headings come from paragraph styles, which Word already gives us and the
  old code partly ignored.
"""

from __future__ import annotations

import io
import statistics
from pathlib import Path
from typing import Any, Optional

import fitz  # PyMuPDF
from docx import Document as DocxDocument
from pptx import Presentation

from app.utils.logging import get_logger
from app.utils.text_cleaning import clean_text

logger = get_logger(__name__)

# A block whose text is at least this much larger than the document's body size is
# treated as a heading. 1.15 is deliberately low: proposal templates often use a
# heading only slightly larger than body text, and missing a heading costs us a
# section boundary, while a false heading merely splits a section in two.
HEADING_SIZE_RATIO = 1.15

# Bold text at body size is a heading only if it is short. A whole bold paragraph
# is emphasis, not a title.
MAX_HEADING_WORDS = 14


def _spans_of(page: fitz.Page) -> list[dict[str, Any]]:
    """Flatten a page into text spans carrying their font size and flags."""
    spans: list[dict[str, Any]] = []
    data = page.get_text("dict")

    for block in data.get("blocks", []):
        if block.get("type") != 0:  # 0 = text, 1 = image
            continue
        for line in block.get("lines", []):
            line_text = "".join(s.get("text", "") for s in line.get("spans", []))
            if not line_text.strip():
                continue

            line_spans = line.get("spans", [])
            if not line_spans:
                continue

            # Take the dominant span's typography as the line's typography.
            dominant = max(line_spans, key=lambda s: len(s.get("text", "")))
            bbox = line.get("bbox", (0, 0, 0, 0))

            spans.append(
                {
                    "text": line_text.strip(),
                    "size": round(float(dominant.get("size", 0)), 1),
                    # Bit 4 of the span flags is the bold bit in PyMuPDF.
                    "bold": bool(int(dominant.get("flags", 0)) & 2**4),
                    "x0": bbox[0],
                    "y0": bbox[1],
                    "x1": bbox[2],
                    "y1": bbox[3],
                }
            )

    return spans


def _sort_reading_order(spans: list[dict[str, Any]], page_width: float) -> list[dict[str, Any]]:
    """
    Put spans into human reading order.

    Detects a two-column layout by checking whether the spans cluster into a left
    and a right group with a clear gutter between them. If they do, we read the
    left column top-to-bottom, then the right — which is what a person does, and
    what the naive extractor got wrong.
    """
    if not spans:
        return []

    midpoint = page_width / 2
    left = [s for s in spans if s["x1"] < midpoint * 1.05]
    right = [s for s in spans if s["x0"] > midpoint * 0.95]

    # Treat it as two columns only when both sides carry real content and almost
    # nothing straddles the middle (a full-width title or table would).
    straddling = len(spans) - len(left) - len(right)
    is_two_column = (
        len(left) >= 3
        and len(right) >= 3
        and straddling <= len(spans) * 0.2
    )

    if is_two_column:
        return sorted(left, key=lambda s: s["y0"]) + sorted(right, key=lambda s: s["y0"])

    # Single column: top-to-bottom, then left-to-right for anything on the same line.
    return sorted(spans, key=lambda s: (round(s["y0"], 1), s["x0"]))


def _body_size(all_spans: list[dict[str, Any]]) -> float:
    """The document's dominant body font size — the baseline headings stand out from."""
    sizes = [s["size"] for s in all_spans if s["size"] > 0 and len(s["text"].split()) > 3]
    if not sizes:
        return 10.0
    try:
        # Mode, not mean: body text is by far the most common size, and a few huge
        # title lines would drag a mean upward and hide real headings.
        return statistics.mode(sizes)
    except statistics.StatisticsError:
        return statistics.median(sizes)


def _is_heading(span: dict[str, Any], body_size: float) -> bool:
    word_count = len(span["text"].split())
    if word_count == 0 or word_count > MAX_HEADING_WORDS:
        return False
    if span["text"].endswith((".", ",", ";")):
        return False  # A sentence, not a title.

    if span["size"] >= body_size * HEADING_SIZE_RATIO:
        return True
    if span["bold"] and span["size"] >= body_size:
        return True
    return False


def extract_text_from_pdf(
    file_path: Optional[str] = None, file_bytes: Optional[bytes] = None
) -> dict:
    """
    Extract PDF text in reading order, marking detected headings.

    Headings are emitted as `## Heading` lines so downstream sectioning has an
    unambiguous, format-independent boundary marker to split on — regardless of
    whether the heading was found via font size in a PDF or a style in a DOCX.
    """
    if file_bytes:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    elif file_path:
        doc = fitz.open(file_path)
    else:
        raise ValueError("Either file_path or file_bytes must be provided")

    try:
        # Two passes: we need the whole document's typography before we can say
        # what counts as a heading in it.
        pages_spans: list[tuple[int, list[dict[str, Any]], float]] = []
        every_span: list[dict[str, Any]] = []

        for page_num in range(len(doc)):
            page = doc[page_num]
            spans = _spans_of(page)
            ordered = _sort_reading_order(spans, page.rect.width)
            pages_spans.append((page_num + 1, ordered, page.rect.width))
            every_span.extend(ordered)

        body = _body_size(every_span)

        pages: list[dict] = []
        full_parts: list[str] = []
        headings: list[str] = []
        has_images = False

        for page_number, spans, _width in pages_spans:
            page = doc[page_number - 1]
            page_images = page.get_images(full=True)
            if page_images:
                has_images = True

            lines: list[str] = []
            for span in spans:
                if _is_heading(span, body):
                    heading = span["text"].strip()
                    headings.append(heading)
                    lines.append(f"\n## {heading}\n")
                else:
                    lines.append(span["text"])

            page_text = clean_text("\n".join(lines))
            pages.append(
                {
                    "page_number": page_number,
                    "text": page_text,
                    "word_count": len(page_text.split()),
                    "has_images": bool(page_images),
                    "image_count": len(page_images),
                }
            )
            full_parts.append(page_text)

        full_text = "\n\n".join(full_parts)

        logger.info(
            "pdf_extracted",
            page_count=len(pages),
            word_count=len(full_text.split()),
            headings=len(headings),
            body_font_size=body,
            has_images=has_images,
        )

        return {
            "text": full_text,
            "pages": pages,
            "page_count": len(pages),
            "headings": headings,
            "has_images": has_images,
        }
    finally:
        doc.close()


def extract_text_from_docx(
    file_path: Optional[str] = None, file_bytes: Optional[bytes] = None
) -> dict:
    """
    Extract DOCX text, using Word's own heading styles as section boundaries.

    Word already tells us what a heading is. The old extractor recorded that in a
    field nobody read and then emitted flat text, throwing the structure away.
    """
    if file_bytes:
        doc = DocxDocument(io.BytesIO(file_bytes))
    elif file_path:
        doc = DocxDocument(file_path)
    else:
        raise ValueError("Either file_path or file_bytes must be provided")

    parts: list[str] = []
    headings: list[str] = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue

        style = para.style.name if para.style else ""
        if "Heading" in style or "Title" in style:
            headings.append(text)
            parts.append(f"\n## {text}\n")
        else:
            parts.append(text)

    # Tables carry the numbers in most application forms — never drop them.
    for table in doc.tables:
        rows: list[str] = []
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                rows.append(" | ".join(cells))
        if rows:
            parts.append("\n".join(rows))

    has_images = any("image" in rel.reltype for rel in doc.part.rels.values())
    full_text = clean_text("\n\n".join(parts))

    logger.info(
        "docx_extracted",
        word_count=len(full_text.split()),
        headings=len(headings),
        table_count=len(doc.tables),
        has_images=has_images,
    )

    return {
        "text": full_text,
        "headings": headings,
        "has_images": has_images,
        "table_count": len(doc.tables),
        "page_count": 1,
    }


def extract_text_from_pptx(
    file_path: Optional[str] = None, file_bytes: Optional[bytes] = None
) -> dict:
    """Extract PPTX text. Slide titles become headings."""
    if file_bytes:
        prs = Presentation(io.BytesIO(file_bytes))
    elif file_path:
        prs = Presentation(file_path)
    else:
        raise ValueError("Either file_path or file_bytes must be provided")

    slides: list[dict] = []
    parts: list[str] = []
    headings: list[str] = []
    has_images = False

    for slide_num, slide in enumerate(prs.slides, 1):
        body: list[str] = []
        title = ""
        slide_has_images = False

        for shape in slide.shapes:
            # The title placeholder is the slide's heading.
            is_title = (
                shape == slide.shapes.title
                if slide.shapes.title is not None
                else False
            )

            if shape.has_text_frame:
                text = "\n".join(
                    p.text.strip() for p in shape.text_frame.paragraphs if p.text.strip()
                )
                if text:
                    if is_title:
                        title = text
                    else:
                        body.append(text)

            if shape.has_table:
                for row in shape.table.rows:
                    cells = [c.text.strip() for c in row.cells if c.text.strip()]
                    if cells:
                        body.append(" | ".join(cells))

            if shape.shape_type == 13:  # Picture
                slide_has_images = True
                has_images = True

        heading = title or f"Slide {slide_num}"
        headings.append(heading)

        slide_text = "\n".join(body)
        slides.append(
            {
                "slide_number": slide_num,
                "text": slide_text,
                "word_count": len(slide_text.split()),
                "has_images": slide_has_images,
            }
        )
        parts.append(f"\n## {heading}\n{slide_text}")

    full_text = clean_text("\n\n".join(parts))

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
        "page_count": len(slides),
        "headings": headings,
        "has_images": has_images,
    }


def extract_text_from_txt(
    file_path: Optional[str] = None, file_bytes: Optional[bytes] = None
) -> dict:
    if file_bytes:
        text = file_bytes.decode("utf-8", errors="replace")
    elif file_path:
        text = Path(file_path).read_text(encoding="utf-8", errors="replace")
    else:
        raise ValueError("Either file_path or file_bytes must be provided")

    cleaned = clean_text(text)
    logger.info("txt_extracted", word_count=len(cleaned.split()))
    return {"text": cleaned, "page_count": 1, "headings": []}


MIME_TO_EXT = {
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


def extract_text(
    file_path: Optional[str] = None,
    file_bytes: Optional[bytes] = None,
    file_type: str = "",
    filename: str = "",
) -> dict:
    """Route to the right extractor by extension, falling back to MIME type."""
    ext = ""
    if filename:
        ext = Path(filename).suffix.lower().lstrip(".")
    if not ext and file_path:
        ext = Path(file_path).suffix.lower().lstrip(".")
    if not ext and file_type:
        ext = MIME_TO_EXT.get(file_type, "")

    logger.info("extracting_text", format=ext, filename=filename)

    if ext == "pdf":
        return extract_text_from_pdf(file_path=file_path, file_bytes=file_bytes)
    if ext in ("docx", "doc"):
        return extract_text_from_docx(file_path=file_path, file_bytes=file_bytes)
    if ext in ("pptx", "ppt"):
        return extract_text_from_pptx(file_path=file_path, file_bytes=file_bytes)
    if ext == "txt":
        return extract_text_from_txt(file_path=file_path, file_bytes=file_bytes)
    if ext in ("png", "jpg", "jpeg", "tiff", "bmp"):
        return {"text": "", "requires_ocr": True, "page_count": 1, "headings": []}

    raise ValueError(f"Unsupported file format: {ext or file_type}")
