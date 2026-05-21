"""
Tests for app.services.processing.chunker — section detection, chunking, metadata tagging.
"""

import pytest
from unittest.mock import patch

from app.models.enums import ChunkPosition, ChunkType
from app.models.schemas import DocumentChunk, ExtractedImage, ExtractedTable
from app.services.processing.chunker import (
    _is_section_heading,
    _find_section_boundaries,
    _split_into_sections,
    _split_text_with_overlap,
    _get_overlap_text,
    _assign_tables_to_chunks,
    _assign_images_to_chunks,
    _estimate_page_numbers,
    chunk_document,
)
from tests.conftest import make_chunk, make_image, make_table


# ============================================================================
# _is_section_heading
# ============================================================================

class TestIsSectionHeading:
    def test_numbered_heading(self):
        assert _is_section_heading("1. Introduction") is True
        assert _is_section_heading("2.1 Market Analysis") is True

    def test_keyword_heading(self):
        assert _is_section_heading("Executive Summary") is True
        assert _is_section_heading("Financial Projections") is True
        assert _is_section_heading("Risk Assessment") is True

    def test_all_caps_heading(self):
        assert _is_section_heading("MARKET ANALYSIS") is True

    def test_too_long_not_heading(self):
        long_text = "This is a really long line that definitely should not be considered a heading because it is way too long " * 2
        assert _is_section_heading(long_text) is False

    def test_too_short_not_heading(self):
        assert _is_section_heading("Hi") is False
        assert _is_section_heading("") is False

    def test_regular_sentence_not_heading(self):
        assert _is_section_heading("The company was founded in 2020 and has grown significantly since then.") is False

    def test_single_word_caps_not_heading(self):
        # Single-word ALL CAPS shouldn't match (needs >= 2 words)
        assert _is_section_heading("HELLO") is False


# ============================================================================
# _find_section_boundaries
# ============================================================================

class TestFindSectionBoundaries:
    def test_finds_boundaries(self):
        text = "1. Introduction\nSome intro text.\n\n2. Solution\nOur solution."
        boundaries = _find_section_boundaries(text)
        titles = [b[1] for b in boundaries]
        assert "1. Introduction" in titles
        assert "2. Solution" in titles

    def test_no_headings(self):
        text = "just plain text without any sections."
        boundaries = _find_section_boundaries(text)
        assert len(boundaries) == 0


# ============================================================================
# _split_into_sections
# ============================================================================

class TestSplitIntoSections:
    def test_single_section_no_headings(self):
        text = "just plain text"
        sections = _split_into_sections(text)
        assert len(sections) == 1
        assert sections[0]["title"] == "Document Content"

    def test_multiple_sections(self):
        text = "Intro paragraph\n\n1. Problem Statement\nWe solve X.\n\n2. Solution\nOur approach."
        sections = _split_into_sections(text)
        # Should have: intro (before 1.), "1. Problem Statement", "2. Solution"
        assert len(sections) >= 2
        titles = [s["title"] for s in sections]
        assert any("Problem" in t for t in titles)

    def test_content_before_first_heading_becomes_intro(self):
        text = "Some preamble text.\n\n1. Executive Summary\nThe summary."
        sections = _split_into_sections(text)
        assert sections[0]["title"] == "Introduction"

    def test_empty_body_sections_skipped(self):
        # A heading with no body text after it should be excluded
        text = "1. Problem\n2. Solution\nOur solution is great."
        sections = _split_into_sections(text)
        # "1. Problem" has no body (the next line is "2. Solution")
        # so it should be skipped
        bodies = [s["text"] for s in sections]
        assert all(b.strip() for b in bodies)


# ============================================================================
# _split_text_with_overlap
# ============================================================================

class TestSplitTextWithOverlap:
    def test_short_text_single_chunk(self):
        text = "Short text."
        chunks = _split_text_with_overlap(text, max_tokens=100, overlap_tokens=20)
        assert len(chunks) == 1
        assert chunks[0]["overlap_with_previous"] is False

    def test_long_text_produces_multiple_chunks(self):
        # Create text that exceeds max_tokens
        text = "\n\n".join(f"Paragraph {i}. " + "word " * 50 for i in range(20))
        chunks = _split_text_with_overlap(text, max_tokens=100, overlap_tokens=20)
        assert len(chunks) > 1
        # Second chunk onwards should have overlap
        assert chunks[1]["overlap_with_previous"] is True

    def test_first_chunk_no_overlap(self):
        text = "\n\n".join("word " * 100 for _ in range(5))
        chunks = _split_text_with_overlap(text, max_tokens=50, overlap_tokens=10)
        assert chunks[0]["overlap_with_previous"] is False


# ============================================================================
# _get_overlap_text
# ============================================================================

class TestGetOverlapText:
    def test_empty_string(self):
        assert _get_overlap_text("", 10) == ""

    def test_short_text_returns_full(self):
        text = "few words here"
        result = _get_overlap_text(text, 100)
        assert result == text

    def test_long_text_returns_tail(self):
        words = " ".join(f"word{i}" for i in range(100))
        result = _get_overlap_text(words, 5)
        result_words = result.split()
        # overlap_words = int(5 * 1.3) = 6
        assert len(result_words) == 6


# ============================================================================
# _estimate_page_numbers
# ============================================================================

class TestEstimatePageNumbers:
    def test_zero_pages(self):
        assert _estimate_page_numbers(0, 100, 1000, 0) == [1]

    def test_zero_chars(self):
        assert _estimate_page_numbers(0, 100, 0, 5) == [1]

    def test_single_page(self):
        result = _estimate_page_numbers(0, 500, 500, 1)
        assert result == [1]

    def test_multi_page(self):
        # 1000 chars, 10 pages = 100 chars/page
        # start=150 → page 2, end=350 → page 4
        result = _estimate_page_numbers(150, 350, 1000, 10)
        assert 2 in result
        assert 4 in result


# ============================================================================
# _assign_tables_to_chunks / _assign_images_to_chunks
# ============================================================================

class TestAssignToChunks:
    def test_assigns_table_by_page(self):
        chunks = [
            make_chunk(page_numbers=[1, 2], chunk_id="c1"),
            make_chunk(page_numbers=[3, 4], chunk_id="c2"),
        ]
        table = make_table(page=3)
        _assign_tables_to_chunks(chunks, [table])
        assert len(chunks[1].tables) == 1
        assert len(chunks[0].tables) == 0

    def test_no_page_assigns_to_first(self):
        chunks = [make_chunk(chunk_id="c1"), make_chunk(chunk_id="c2")]
        table = make_table(page=None)
        _assign_tables_to_chunks(chunks, [table])
        assert len(chunks[0].tables) == 1

    def test_unmatched_page_assigns_to_last(self):
        chunks = [make_chunk(page_numbers=[1], chunk_id="c1")]
        table = make_table(page=99)
        _assign_tables_to_chunks(chunks, [table])
        assert len(chunks[0].tables) == 1  # last chunk = only chunk

    def test_assigns_image_by_page(self):
        chunks = [
            make_chunk(page_numbers=[1], chunk_id="c1"),
            make_chunk(page_numbers=[2], chunk_id="c2"),
        ]
        image = make_image(page=2)
        _assign_images_to_chunks(chunks, [image])
        assert len(chunks[1].images) == 1

    def test_empty_chunks_no_error(self):
        _assign_tables_to_chunks([], [make_table()])
        _assign_images_to_chunks([], [make_image()])


# ============================================================================
# chunk_document (integration)
# ============================================================================

class TestChunkDocument:
    def test_empty_text_returns_empty(self):
        assert chunk_document("") == []
        assert chunk_document("   ") == []

    def test_basic_chunking(self):
        text = "1. Introduction\nThis is a startup proposal.\n\n2. Solution\nWe build a platform."
        chunks = chunk_document(text)
        assert len(chunks) >= 1
        assert all(isinstance(c, DocumentChunk) for c in chunks)

    def test_first_chunk_is_start(self):
        text = "1. Intro\nContent here.\n\n2. More\nMore content."
        chunks = chunk_document(text)
        assert chunks[0].position == ChunkPosition.START

    def test_last_chunk_is_end(self):
        text = "1. Intro\nContent here.\n\n2. More\nMore content."
        chunks = chunk_document(text)
        if len(chunks) > 1:
            assert chunks[-1].position == ChunkPosition.END

    def test_financial_content_detected(self):
        text = (
            "1. Financial Plan\n"
            "Revenue model: $5M revenue with $2M budget. "
            "ROI is expected at 3x. Investment required: $1M."
        )
        chunks = chunk_document(text)
        financial_chunks = [c for c in chunks if c.has_financial_data]
        assert len(financial_chunks) >= 1

    def test_technical_content_detected(self):
        text = (
            "1. Technical Architecture\n"
            "Our cloud infrastructure uses Kubernetes with microservices. "
            "The API gateway handles 10K requests/s via Docker containers."
        )
        chunks = chunk_document(text)
        tech_chunks = [c for c in chunks if c.has_technical_content]
        assert len(tech_chunks) >= 1

    def test_tables_appended_to_chunk_text(self):
        text = "Financial summary of our proposal. " * 20  # Enough plain text
        table = make_table(page=1, raw_text="Revenue: $1M | Cost: $500K")
        chunks = chunk_document(text, tables=[table], page_count=1)
        assert len(chunks) > 0
        # Table text should be appended to the relevant chunk
        assert any("[Table" in c.text for c in chunks)

    def test_images_with_ocr_appended(self):
        text = "Visual content about architecture and system design. " * 20
        image = make_image(page=1, ocr_text="System diagram text")
        chunks = chunk_document(text, images=[image], page_count=1)
        assert len(chunks) > 0
        assert any("[Image" in c.text for c in chunks)

    def test_chunk_ids_are_unique(self):
        text = "1. A\nContent.\n\n2. B\nMore.\n\n3. C\nEven more content."
        chunks = chunk_document(text)
        ids = [c.chunk_id for c in chunks]
        assert len(ids) == len(set(ids))

    def test_word_count_accurate(self):
        text = "1. Section\none two three four five"
        chunks = chunk_document(text)
        for c in chunks:
            assert c.word_count == len(c.text.split())
