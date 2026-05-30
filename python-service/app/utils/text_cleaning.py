"""
Text cleaning and preprocessing utilities.
Handles noise removal, normalization, and text quality improvement
before chunking and LLM consumption.
"""

import re
import unicodedata


def normalize_unicode(text: str) -> str:
    """Normalize unicode characters to their canonical form."""
    return unicodedata.normalize("NFKC", text)


def remove_control_characters(text: str) -> str:
    """Remove non-printable control characters except newlines and tabs."""
    return "".join(
        ch for ch in text
        if unicodedata.category(ch)[0] != "C" or ch in ("\n", "\t", "\r")
    )


def collapse_whitespace(text: str) -> str:
    """Collapse multiple spaces/tabs into single spaces, preserve newlines."""
    # Collapse horizontal whitespace
    text = re.sub(r"[^\S\n]+", " ", text)
    # Collapse 3+ consecutive newlines into 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def remove_page_markers(text: str) -> str:
    """Remove common page number patterns and headers/footers."""
    # Page numbers: "Page 1", "- 1 -", "1 of 10", standalone numbers
    text = re.sub(r"(?m)^\s*[-–—]?\s*\d+\s*[-–—]?\s*$", "", text)
    text = re.sub(r"(?mi)^\s*page\s+\d+\s*(of\s+\d+)?\s*$", "", text)
    # Common footer patterns
    text = re.sub(r"(?mi)^\s*confidential\s*$", "", text)
    text = re.sub(r"(?mi)^\s*draft\s*$", "", text)
    return text


def remove_repeated_headers(text: str) -> str:
    """Detect and remove headers/footers that repeat across pages."""
    lines = text.split("\n")
    if len(lines) < 20:
        return text

    # Count line occurrences — lines appearing 3+ times are likely headers/footers
    line_counts: dict[str, int] = {}
    for line in lines:
        stripped = line.strip()
        if stripped and len(stripped) > 3:
            line_counts[stripped] = line_counts.get(stripped, 0) + 1

    repeated = {line for line, count in line_counts.items() if count >= 3}

    if not repeated:
        return text

    filtered = [line for line in lines if line.strip() not in repeated]
    return "\n".join(filtered)


def clean_ocr_artifacts(text: str) -> str:
    """Clean common OCR artifacts and noise."""
    # Remove isolated single characters that are likely OCR noise
    text = re.sub(r"(?m)^\s*[|Il]{1}\s*$", "", text)
    # Fix common OCR substitutions
    text = re.sub(r"(?<=[a-z])0(?=[a-z])", "o", text)  # 0 -> o in words
    text = re.sub(r"(?<=[a-z])1(?=[a-z])", "l", text)  # 1 -> l in words
    # Remove excessive dots/dashes (table of contents artifacts)
    text = re.sub(r"[.]{4,}", " ", text)
    text = re.sub(r"[-]{4,}", " ", text)
    return text


def fix_line_breaks(text: str) -> str:
    """Fix mid-sentence line breaks (hyphenated words, wrapped lines)."""
    # Re-join hyphenated words at line breaks
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    # Join lines that don't end with sentence-ending punctuation
    # (but preserve paragraph breaks — double newlines)
    lines = text.split("\n")
    result = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            result.append("")
            continue
        # If the next line exists and current line doesn't end with sentence punctuation
        if (
            i + 1 < len(lines)
            and lines[i + 1].strip()
            and stripped
            and not stripped[-1] in ".!?:;\"')"
            and not stripped.startswith(("-", "•", "*", "–", "—"))
            and not re.match(r"^\d+[.)]\s", stripped)
            and len(stripped) > 20
        ):
            result.append(stripped + " ")
        else:
            result.append(stripped + "\n")

    return "".join(result)


def clean_text(text: str, is_ocr: bool = False) -> str:
    """
    Full text cleaning pipeline.

    Args:
        text: Raw extracted text.
        is_ocr: Whether the text came from OCR (applies additional cleaning).

    Returns:
        Cleaned, normalized text.
    """
    if not text:
        return ""

    text = normalize_unicode(text)
    text = remove_control_characters(text)
    text = remove_page_markers(text)
    text = remove_repeated_headers(text)

    if is_ocr:
        text = clean_ocr_artifacts(text)

    text = fix_line_breaks(text)
    text = collapse_whitespace(text)

    return text


def estimate_token_count(text: str) -> int:
    """
    Estimate token count using the ~4 chars per token heuristic.
    This is a fast approximation; use tiktoken for exact counts.
    """
    return max(1, len(text) // 4)


def detect_section_headings(text: str) -> list[tuple[int, str]]:
    """
    Detect section headings in the text and return their positions.

    Returns:
        List of (char_position, heading_text) tuples.
    """
    headings: list[tuple[int, str]] = []

    # Common proposal section patterns
    heading_patterns = [
        # Numbered headings: "1. Introduction", "1.1 Overview"
        r"(?m)^(\d+(?:\.\d+)*\.?\s+[A-Z][^\n]{3,80})$",
        # ALL CAPS headings
        r"(?m)^([A-Z][A-Z\s&/,]{5,60})$",
        # Title-case lines that are short (likely headings)
        r"(?m)^([A-Z][a-zA-Z\s&/:,–-]{5,60})$",
    ]

    for pattern in heading_patterns:
        for match in re.finditer(pattern, text):
            heading = match.group(1).strip()
            # Filter out false positives
            if (
                len(heading.split()) >= 2
                and not heading.endswith(".")
                and not any(c.isdigit() for c in heading if heading.index(c) > 5)
            ):
                headings.append((match.start(), heading))

    # Deduplicate and sort by position
    seen = set()
    unique_headings = []
    for pos, heading in sorted(headings, key=lambda x: x[0]):
        if heading not in seen:
            seen.add(heading)
            unique_headings.append((pos, heading))

    return unique_headings


def detect_financial_content(text: str) -> bool:
    """Check if text contains financial data indicators."""
    financial_keywords = [
        r"\$\d", r"revenue", r"profit", r"cost", r"budget", r"funding",
        r"investment", r"roi\b", r"burn rate", r"valuation", r"arpu",
        r"cac\b", r"ltv\b", r"mrr\b", r"arr\b", r"unit economics",
        r"financial", r"capital", r"expenditure", r"margin",
    ]
    text_lower = text.lower()
    return sum(1 for kw in financial_keywords if re.search(kw, text_lower)) >= 2


def detect_technical_content(text: str) -> bool:
    """Check if text contains technical content indicators."""
    technical_keywords = [
        r"api\b", r"cloud", r"architecture", r"database", r"algorithm",
        r"machine learning", r"ml\b", r"ai\b", r"infrastructure",
        r"scalab", r"microservice", r"docker", r"kubernetes",
        r"framework", r"technology", r"platform", r"integration",
        r"deploy", r"devops", r"pipeline", r"iot\b", r"sensor",
    ]
    text_lower = text.lower()
    return sum(1 for kw in technical_keywords if re.search(kw, text_lower)) >= 2


def merge_broken_paragraphs(text: str) -> str:
    """
    Merge lines that appear to be broken mid-sentence.
    Detects short lines followed by continuation lines (common in OCR/PDF extraction).
    """
    lines = text.split("\n")
    if len(lines) < 3:
        return text

    merged: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            merged.append("")
            i += 1
            continue

        # Check if this line looks broken: short, doesn't end with sentence-ending
        # punctuation, and the next line starts with a lowercase letter
        if (
            i + 1 < len(lines)
            and 10 < len(stripped) < 80
            and stripped[-1] not in ".!?:;\"')"
            and not stripped.startswith(("-", "•", "*", "–", "—"))
            and not re.match(r"^\d+[.)]", stripped)
            and lines[i + 1].strip()
            and lines[i + 1].strip()[0:1].islower()
        ):
            merged.append(stripped + " " + lines[i + 1].strip())
            i += 2
        else:
            merged.append(stripped)
            i += 1

    return "\n".join(merged)


def remove_excessive_symbols(text: str) -> str:
    """Remove lines with >50% non-alphabetic characters (likely OCR artifacts)."""
    lines = text.split("\n")
    cleaned = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            cleaned.append("")
            continue
        alpha_count = sum(1 for c in stripped if c.isalpha())
        if len(stripped) > 5 and alpha_count / len(stripped) < 0.3:
            continue  # Skip artifact lines
        cleaned.append(stripped)
    return "\n".join(cleaned)


def assess_text_quality(text: str) -> float:
    """
    Assess OCR/extraction text quality on a 0.0-1.0 scale.

    Factors:
    - Ratio of alphabetic chars vs symbols
    - Average word length (too short = OCR noise)
    - Presence of common structural words
    - Line length variance

    Returns:
        Float between 0.0 (garbage) and 1.0 (clean text).
    """
    if not text or not text.strip():
        return 0.0

    words = text.split()
    if len(words) < 5:
        return 0.1

    score = 0.0

    # Factor 1: Alpha ratio (weight 0.3)
    alpha_chars = sum(1 for c in text if c.isalpha())
    total_chars = len(text.replace(" ", "").replace("\n", ""))
    if total_chars > 0:
        alpha_ratio = alpha_chars / total_chars
        score += min(alpha_ratio / 0.7, 1.0) * 0.3

    # Factor 2: Average word length (weight 0.2)
    avg_word_len = sum(len(w) for w in words) / len(words)
    if 3.0 <= avg_word_len <= 10.0:
        score += 0.2
    elif 2.0 <= avg_word_len < 3.0 or 10.0 < avg_word_len <= 15.0:
        score += 0.1

    # Factor 3: Common structural words present (weight 0.3)
    structural_words = {
        "the", "and", "for", "with", "that", "this", "from",
        "have", "will", "are", "our", "can", "not", "but",
        "project", "team", "solution", "problem", "market",
    }
    text_lower = text.lower()
    structural_count = sum(1 for w in structural_words if f" {w} " in text_lower)
    score += min(structural_count / 8, 1.0) * 0.3

    # Factor 4: Reasonable line lengths (weight 0.2)
    lines = [l for l in text.split("\n") if l.strip()]
    if lines:
        avg_line_len = sum(len(l) for l in lines) / len(lines)
        if 20 <= avg_line_len <= 200:
            score += 0.2
        elif 10 <= avg_line_len < 20 or 200 < avg_line_len <= 500:
            score += 0.1

    return round(min(1.0, max(0.0, score)), 2)
