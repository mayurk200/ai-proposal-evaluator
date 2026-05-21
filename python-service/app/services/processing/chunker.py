"""
Strategic document chunker with metadata-aware splitting.

Handles:
- Section-based splitting (detects headings and splits on section boundaries)
- Size-aware splitting with overlap for context continuity
- Metadata tagging (financial, technical, section title, page numbers)
- Table and image preservation (never split across chunks)
"""

import re
import uuid
from typing import Optional

from app.config import settings
from app.models.enums import ChunkPosition, ChunkType
from app.models.schemas import DocumentChunk, ExtractedImage, ExtractedTable
from app.utils.logging import get_logger
from app.utils.text_cleaning import (
    detect_financial_content,
    detect_technical_content,
    detect_section_headings,
    estimate_token_count,
)

logger = get_logger(__name__)

# Common section heading keywords for startup proposals
SECTION_KEYWORDS = [
    "executive summary", "introduction", "overview", "problem statement",
    "problem", "solution", "proposed solution", "approach",
    "market analysis", "market", "target market", "market opportunity",
    "business model", "revenue model", "revenue", "monetization",
    "financial", "financials", "budget", "funding", "investment",
    "team", "founders", "leadership", "management",
    "technology", "technical", "architecture", "tech stack",
    "competitive", "competition", "competitive analysis",
    "traction", "milestones", "progress", "timeline",
    "risk", "risks", "challenges",
    "sustainability", "impact", "social impact", "environmental",
    "scalability", "growth", "scaling",
    "compliance", "regulatory", "governance", "legal",
    "conclusion", "summary", "appendix", "references",
    "innovation", "intellectual property", "ip",
]


def _is_section_heading(text: str) -> bool:
    """Check if a line is likely a section heading."""
    text_lower = text.strip().lower()
    text_stripped = text.strip()

    # Too long for a heading
    if len(text_stripped) > 100:
        return False

    # Too short
    if len(text_stripped) < 3:
        return False

    # Numbered heading pattern: "1. Introduction", "2.1 Market Analysis"
    if re.match(r"^\d+(\.\d+)*\.?\s+\S", text_stripped):
        return True

    # Check against known section keywords
    for keyword in SECTION_KEYWORDS:
        if keyword in text_lower:
            # Make sure it's a standalone heading, not part of a sentence
            words = text_stripped.split()
            if len(words) <= 8:
                return True

    # ALL CAPS lines (3+ words)
    if text_stripped.isupper() and len(text_stripped.split()) >= 2:
        return True

    return False


def _find_section_boundaries(text: str) -> list[tuple[int, str]]:
    """
    Find section boundaries in the text.

    Returns:
        List of (char_position, section_title) tuples.
    """
    boundaries: list[tuple[int, str]] = []
    lines = text.split("\n")
    char_pos = 0

    for line in lines:
        stripped = line.strip()
        if stripped and _is_section_heading(stripped):
            boundaries.append((char_pos, stripped))
        char_pos += len(line) + 1  # +1 for newline

    return boundaries


def _split_into_sections(text: str) -> list[dict]:
    """
    Split text into sections based on detected headings.

    Returns:
        List of dicts with keys: title, text, start_pos, end_pos
    """
    boundaries = _find_section_boundaries(text)

    if not boundaries:
        # No sections detected — treat entire text as one section
        return [{"title": "Document Content", "text": text, "start_pos": 0, "end_pos": len(text)}]

    sections = []

    # Content before first heading
    if boundaries[0][0] > 0:
        pre_text = text[: boundaries[0][0]].strip()
        if pre_text:
            sections.append({
                "title": "Introduction",
                "text": pre_text,
                "start_pos": 0,
                "end_pos": boundaries[0][0],
            })

    # Each section
    for i, (pos, title) in enumerate(boundaries):
        end_pos = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(text)
        section_text = text[pos:end_pos].strip()

        # Remove the heading line from the text body
        lines = section_text.split("\n", 1)
        body = lines[1].strip() if len(lines) > 1 else ""

        if body:
            sections.append({
                "title": title,
                "text": body,
                "start_pos": pos,
                "end_pos": end_pos,
            })

    return sections


def _split_text_with_overlap(
    text: str,
    max_tokens: int,
    overlap_tokens: int,
) -> list[dict]:
    """
    Split a text block into smaller chunks with overlap.

    Tries to split on paragraph boundaries (double newlines) first,
    falls back to sentence boundaries, then word boundaries.

    Returns:
        List of dicts with keys: text, overlap_with_previous
    """
    total_tokens = estimate_token_count(text)
    if total_tokens <= max_tokens:
        return [{"text": text, "overlap_with_previous": False}]

    chunks = []
    # Split on paragraphs first
    paragraphs = re.split(r"\n\n+", text)

    current_chunk: list[str] = []
    current_tokens = 0

    for para in paragraphs:
        para_tokens = estimate_token_count(para)

        if para_tokens > max_tokens:
            # This paragraph is too large — split on sentences
            if current_chunk:
                chunks.append({
                    "text": "\n\n".join(current_chunk),
                    "overlap_with_previous": bool(len(chunks) > 0),
                })
                # Create overlap: take last part of current chunk
                overlap_text = _get_overlap_text(
                    "\n\n".join(current_chunk), overlap_tokens
                )
                current_chunk = [overlap_text] if overlap_text else []
                current_tokens = estimate_token_count(overlap_text) if overlap_text else 0

            # Split the large paragraph into sentences
            sentences = re.split(r"(?<=[.!?])\s+", para)
            for sentence in sentences:
                sent_tokens = estimate_token_count(sentence)
                if current_tokens + sent_tokens > max_tokens and current_chunk:
                    chunks.append({
                        "text": " ".join(current_chunk),
                        "overlap_with_previous": bool(len(chunks) > 0),
                    })
                    overlap_text = _get_overlap_text(
                        " ".join(current_chunk), overlap_tokens
                    )
                    current_chunk = [overlap_text] if overlap_text else []
                    current_tokens = estimate_token_count(overlap_text) if overlap_text else 0

                current_chunk.append(sentence)
                current_tokens += sent_tokens
        elif current_tokens + para_tokens > max_tokens:
            # Adding this paragraph would exceed limit
            chunks.append({
                "text": "\n\n".join(current_chunk),
                "overlap_with_previous": bool(len(chunks) > 0),
            })
            overlap_text = _get_overlap_text(
                "\n\n".join(current_chunk), overlap_tokens
            )
            current_chunk = [overlap_text, para] if overlap_text else [para]
            current_tokens = (
                estimate_token_count(overlap_text) + para_tokens if overlap_text else para_tokens
            )
        else:
            current_chunk.append(para)
            current_tokens += para_tokens

    # Don't forget the last chunk
    if current_chunk:
        chunks.append({
            "text": "\n\n".join(current_chunk),
            "overlap_with_previous": bool(len(chunks) > 0),
        })

    return chunks


def _get_overlap_text(text: str, overlap_tokens: int) -> str:
    """Get the last N tokens worth of text for overlap."""
    if not text:
        return ""
    words = text.split()
    # Approximate: ~1.3 words per token
    overlap_words = int(overlap_tokens * 1.3)
    if len(words) <= overlap_words:
        return text
    return " ".join(words[-overlap_words:])


def _assign_tables_to_chunks(
    chunks: list[DocumentChunk],
    tables: list[ExtractedTable],
) -> None:
    """Assign tables to chunks based on page number overlap."""
    for table in tables:
        if table.page_number is None:
            # Assign to first chunk if no page info
            if chunks:
                chunks[0].tables.append(table)
            continue

        assigned = False
        for chunk in chunks:
            if table.page_number in chunk.page_numbers:
                chunk.tables.append(table)
                chunk.has_financial_data = chunk.has_financial_data or detect_financial_content(
                    table.raw_text
                )
                assigned = True
                break

        if not assigned and chunks:
            # Assign to closest chunk
            chunks[-1].tables.append(table)


def _assign_images_to_chunks(
    chunks: list[DocumentChunk],
    images: list[ExtractedImage],
) -> None:
    """Assign images to chunks based on page number overlap."""
    for image in images:
        if image.page_number is None:
            if chunks:
                chunks[0].images.append(image)
            continue

        assigned = False
        for chunk in chunks:
            if image.page_number in chunk.page_numbers:
                chunk.images.append(image)
                assigned = True
                break

        if not assigned and chunks:
            chunks[-1].images.append(image)


def chunk_document(
    text: str,
    tables: Optional[list[ExtractedTable]] = None,
    images: Optional[list[ExtractedImage]] = None,
    page_count: int = 0,
    max_chunk_tokens: Optional[int] = None,
    overlap_tokens: Optional[int] = None,
) -> list[DocumentChunk]:
    """
    Strategically chunk a document into metadata-rich segments.

    Strategy:
    1. Detect section boundaries (headings)
    2. Split into sections
    3. If a section is too large, split with overlap
    4. Tag each chunk with metadata (financial, technical, position)
    5. Assign tables and images to their respective chunks

    Args:
        text: Full document text.
        tables: Extracted tables from the document.
        images: Extracted images from the document.
        page_count: Total pages in the document.
        max_chunk_tokens: Max tokens per chunk.
        overlap_tokens: Overlap tokens between chunks.

    Returns:
        List of DocumentChunk with full metadata.
    """
    max_tokens = max_chunk_tokens or settings.CHUNK_SIZE_TOKENS
    overlap = overlap_tokens or settings.CHUNK_OVERLAP_TOKENS
    tables = tables or []
    images = images or []

    if not text.strip():
        return []

    # Step 1: Split into sections
    sections = _split_into_sections(text)

    # Step 2: For each section, split if needed, then create chunks
    all_chunks: list[DocumentChunk] = []

    for section in sections:
        sub_chunks = _split_text_with_overlap(
            section["text"], max_tokens, overlap
        )

        for sub in sub_chunks:
            chunk_text = sub["text"]
            if not chunk_text.strip():
                continue

            # Estimate page numbers for this chunk
            chunk_pages = _estimate_page_numbers(
                section["start_pos"],
                section["end_pos"],
                len(text),
                page_count,
            )

            # Detect content type
            is_financial = detect_financial_content(chunk_text)
            is_technical = detect_technical_content(chunk_text)

            # Determine chunk type
            chunk_type = ChunkType.TEXT
            if is_financial:
                chunk_type = ChunkType.FINANCIAL_DATA
            elif is_technical:
                chunk_type = ChunkType.TECHNICAL_CONTENT
            if is_financial and is_technical:
                chunk_type = ChunkType.MIXED

            chunk = DocumentChunk(
                chunk_id=str(uuid.uuid4()),
                text=chunk_text,
                section_title=section["title"],
                page_numbers=chunk_pages,
                chunk_type=chunk_type,
                word_count=len(chunk_text.split()),
                has_financial_data=is_financial,
                has_technical_content=is_technical,
                position=ChunkPosition.MIDDLE,
                overlap_with_previous=sub["overlap_with_previous"],
            )
            all_chunks.append(chunk)

    # Step 3: Set positions
    if all_chunks:
        all_chunks[0].position = ChunkPosition.START
        all_chunks[-1].position = ChunkPosition.END
        if len(all_chunks) == 1:
            all_chunks[0].position = ChunkPosition.START

    # Step 4: Assign tables and images
    _assign_tables_to_chunks(all_chunks, tables)
    _assign_images_to_chunks(all_chunks, images)

    # Step 5: Append table text to chunks that contain tables
    for chunk in all_chunks:
        if chunk.tables:
            table_text = "\n\n".join(
                f"[Table {t.table_index + 1}]\n{t.raw_text}" for t in chunk.tables
            )
            chunk.text += f"\n\n{table_text}"
            chunk.word_count = len(chunk.text.split())

        if chunk.images:
            img_text = "\n\n".join(
                f"[Image {img.image_index + 1} OCR]: {img.ocr_text}"
                for img in chunk.images
                if img.ocr_text
            )
            if img_text:
                chunk.text += f"\n\n{img_text}"
                chunk.word_count = len(chunk.text.split())

    logger.info(
        "document_chunked",
        total_chunks=len(all_chunks),
        sections=len(sections),
        avg_words=sum(c.word_count for c in all_chunks) // max(len(all_chunks), 1),
    )

    return all_chunks


def _estimate_page_numbers(
    start_pos: int,
    end_pos: int,
    total_chars: int,
    total_pages: int,
) -> list[int]:
    """Estimate which pages a text span covers."""
    if total_pages == 0 or total_chars == 0:
        return [1]

    chars_per_page = total_chars / total_pages
    start_page = max(1, int(start_pos / chars_per_page) + 1)
    end_page = min(total_pages, int(end_pos / chars_per_page) + 1)

    return list(range(start_page, end_page + 1))
