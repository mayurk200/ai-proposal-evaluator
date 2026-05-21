"""
Tests for app.utils.text_cleaning — every function, every branch.
"""

import pytest
from app.utils.text_cleaning import (
    normalize_unicode,
    remove_control_characters,
    collapse_whitespace,
    remove_page_markers,
    remove_repeated_headers,
    clean_ocr_artifacts,
    fix_line_breaks,
    clean_text,
    estimate_token_count,
    detect_section_headings,
    detect_financial_content,
    detect_technical_content,
)


# ============================================================================
# normalize_unicode
# ============================================================================

class TestNormalizeUnicode:
    def test_nfkc_normalization(self):
        # NFKC replaces compatibility chars — e.g. ﬁ ligature -> fi
        assert normalize_unicode("ﬁnance") == "finance"

    def test_plain_ascii_unchanged(self):
        assert normalize_unicode("hello world") == "hello world"

    def test_empty_string(self):
        assert normalize_unicode("") == ""

    def test_fullwidth_chars(self):
        # NFKC converts fullwidth digits to normal
        assert normalize_unicode("１２３") == "123"


# ============================================================================
# remove_control_characters
# ============================================================================

class TestRemoveControlCharacters:
    def test_preserves_newlines_tabs(self):
        text = "line1\nline2\tindented"
        assert remove_control_characters(text) == text

    def test_removes_null_bytes(self):
        assert remove_control_characters("hello\x00world") == "helloworld"

    def test_removes_bell(self):
        assert remove_control_characters("alert\x07!") == "alert!"

    def test_preserves_carriage_return(self):
        assert "\r" in remove_control_characters("line\r\n")

    def test_empty_string(self):
        assert remove_control_characters("") == ""


# ============================================================================
# collapse_whitespace
# ============================================================================

class TestCollapseWhitespace:
    def test_collapses_multiple_spaces(self):
        assert collapse_whitespace("hello    world") == "hello world"

    def test_collapses_tabs(self):
        assert collapse_whitespace("hello\t\tworld") == "hello world"

    def test_collapses_excess_newlines(self):
        result = collapse_whitespace("a\n\n\n\n\nb")
        assert result == "a\n\nb"

    def test_preserves_double_newline(self):
        assert collapse_whitespace("a\n\nb") == "a\n\nb"

    def test_strips_outer_whitespace(self):
        assert collapse_whitespace("  hello  ") == "hello"

    def test_empty_string(self):
        assert collapse_whitespace("") == ""


# ============================================================================
# remove_page_markers
# ============================================================================

class TestRemovePageMarkers:
    def test_removes_standalone_numbers(self):
        assert "5" not in remove_page_markers("content\n5\nmore")

    def test_removes_page_n(self):
        result = remove_page_markers("content\nPage 3\nmore")
        assert "Page 3" not in result

    def test_removes_page_n_of_m(self):
        result = remove_page_markers("content\nPage 1 of 10\nmore")
        assert "Page 1 of 10" not in result

    def test_removes_dash_number_dash(self):
        result = remove_page_markers("content\n- 5 -\nmore")
        assert "- 5 -" not in result

    def test_removes_confidential_footer(self):
        result = remove_page_markers("content\nConfidential\nmore")
        assert "Confidential" not in result

    def test_removes_draft_footer(self):
        result = remove_page_markers("content\nDraft\nmore")
        assert "Draft" not in result

    def test_preserves_inline_numbers(self):
        text = "Revenue is $5 million"
        assert remove_page_markers(text) == text


# ============================================================================
# remove_repeated_headers
# ============================================================================

class TestRemoveRepeatedHeaders:
    def test_removes_repeated_lines(self):
        lines = (
            ["Company XYZ Proposal"] * 4
            + [f"content line {i}" for i in range(20)]
        )
        text = "\n".join(lines)
        result = remove_repeated_headers(text)
        assert "Company XYZ Proposal" not in result
        assert "content line 5" in result

    def test_short_docs_unchanged(self):
        text = "\n".join(["short doc"] * 5)
        assert remove_repeated_headers(text) == text

    def test_no_repeated_lines(self):
        text = "\n".join(f"unique line {i}" for i in range(25))
        assert remove_repeated_headers(text) == text

    def test_ignores_short_repeated_lines(self):
        # Lines <= 3 chars should be ignored
        lines = ["Hi"] * 5 + [f"content {i}" for i in range(20)]
        text = "\n".join(lines)
        result = remove_repeated_headers(text)
        assert result.count("Hi") == 5


# ============================================================================
# clean_ocr_artifacts
# ============================================================================

class TestCleanOCRArtifacts:
    def test_replaces_zero_in_words(self):
        assert clean_ocr_artifacts("techn0logy") == "technology"

    def test_replaces_one_in_words(self):
        assert clean_ocr_artifacts("mu1tip1e") == "multiple"

    def test_removes_excessive_dots(self):
        assert "......" not in clean_ocr_artifacts("Chapter 1...........5")

    def test_removes_excessive_dashes(self):
        assert "------" not in clean_ocr_artifacts("section------divider")

    def test_removes_isolated_pipe(self):
        result = clean_ocr_artifacts("text\n|\nmore")
        assert result.strip().count("|") == 0


# ============================================================================
# fix_line_breaks
# ============================================================================

class TestFixLineBreaks:
    def test_rejoins_hyphenated_words(self):
        result = fix_line_breaks("technol-\nogy")
        assert "technology" in result

    def test_preserves_paragraph_breaks(self):
        text = "paragraph one.\n\nparagraph two."
        result = fix_line_breaks(text)
        assert "paragraph one." in result
        assert "paragraph two." in result

    def test_does_not_join_bulleted_lines(self):
        text = "introduction\n- bullet point one\n- bullet point two"
        result = fix_line_breaks(text)
        assert "- bullet point" in result

    def test_does_not_join_numbered_lines(self):
        text = "overview\n1. First item\n2. Second item"
        result = fix_line_breaks(text)
        assert "1. First item" in result

    def test_empty_string(self):
        assert fix_line_breaks("") == ""


# ============================================================================
# clean_text (integration of all steps)
# ============================================================================

class TestCleanText:
    def test_empty_returns_empty(self):
        assert clean_text("") == ""

    def test_full_pipeline_runs(self):
        dirty = "  Hello\x00   World  \n\n\n\n\nPage 1\n"
        result = clean_text(dirty)
        assert "\x00" not in result
        assert "Page 1" not in result

    def test_ocr_mode_cleans_artifacts(self):
        result = clean_text("techn0logy re10rt", is_ocr=True)
        assert "technology" in result

    def test_non_ocr_preserves_numbers(self):
        result = clean_text("techn0logy", is_ocr=False)
        # Without OCR mode, the zero-to-o substitution should NOT run
        assert "techn0logy" in result


# ============================================================================
# estimate_token_count
# ============================================================================

class TestEstimateTokenCount:
    def test_basic_estimate(self):
        text = "a" * 400
        # 400 chars ÷ 4 = 100 tokens
        assert estimate_token_count(text) == 100

    def test_empty_returns_one(self):
        # max(1, 0) = 1
        assert estimate_token_count("") == 1

    def test_short_string(self):
        assert estimate_token_count("hi") >= 1


# ============================================================================
# detect_section_headings
# ============================================================================

class TestDetectSectionHeadings:
    def test_detects_numbered_heading(self):
        text = "1. Executive Summary\nSome body text here."
        headings = detect_section_headings(text)
        titles = [h[1] for h in headings]
        assert any("Executive Summary" in t for t in titles)

    def test_detects_all_caps_heading(self):
        text = "MARKET ANALYSIS\nThe target market is worth $5B."
        headings = detect_section_headings(text)
        titles = [h[1] for h in headings]
        assert any("MARKET ANALYSIS" in t for t in titles)

    def test_returns_empty_for_plain_text(self):
        text = "just a normal sentence without any headings at all."
        headings = detect_section_headings(text)
        assert len(headings) == 0


# ============================================================================
# detect_financial_content
# ============================================================================

class TestDetectFinancialContent:
    def test_detects_financial_text(self):
        text = "Revenue is $5M with a budget of $2M. ROI is expected at 3x."
        assert detect_financial_content(text) is True

    def test_rejects_non_financial_text(self):
        text = "The weather is nice today. We went to the park."
        assert detect_financial_content(text) is False

    def test_needs_at_least_two_keywords(self):
        text = "We have a budget"
        assert detect_financial_content(text) is False


# ============================================================================
# detect_technical_content
# ============================================================================

class TestDetectTechnicalContent:
    def test_detects_technical_text(self):
        text = "Our cloud architecture uses microservices deployed via Docker and Kubernetes."
        assert detect_technical_content(text) is True

    def test_rejects_non_technical_text(self):
        text = "The company was founded in 2020 in San Francisco."
        assert detect_technical_content(text) is False

    def test_needs_at_least_two_keywords(self):
        text = "We use an API"
        assert detect_technical_content(text) is False
