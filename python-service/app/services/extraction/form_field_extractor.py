"""
Form-field extractor for AIAIC-style proposals.

AIAIC proposals are structured as form-based Q&A documents where:
- Questions appear as labels (often bold/larger font) followed by answer text
- Tables are rendered as inline text (not detected by PDF table finders)
- Data spans across pages (e.g., team tables across 3 pages)
- Financial numbers use Indian format (13,22,50,000)

This extractor identifies Q&A patterns, reconstructs inline tables,
and produces a structured field map for downstream agents.
"""

import re
from typing import Optional

from app.utils.logging import get_logger

logger = get_logger(__name__)


# =============================================================================
# Known AIAIC form fields — the questions we expect to find in proposals
# =============================================================================

AIAIC_FORM_FIELDS = [
    # Identity & Meta
    "Application Id",
    "Problem Statements",
    "Choose Application Track",
    "Name",
    "Email",
    "Contact Number",
    "Company Name",
    "CIN/Registration No",
    "GSTIN",
    "Startup India / DPIIT Recognition No",
    "UDYAM Registration",
    "State",
    "Registered Address",
    "Operational Address",
    "Website",
    "Year of Incorporation",
    "Employees",
    "Stage",

    # Financials & Traction
    "Revenue",
    "Funding raised till date",
    "Unit economics",
    "Committed pipeline or LOIs",
    "Upload financial documents",

    # Product
    "Project/Product Name",
    "Solution Synopsis",
    "Explain the technology you are using in detail",
    "TRL Level",
    "IP Status",
    "Current Customers/Pilots",
    "Data Sources Used",

    # Value Proposition & Impact
    "Unique Value Proposition",
    "Farmer-centric Benefits",
    "Farmer\u2011centric Benefits",
    "Number of farmers expected to be impacted",
    "How many farmers, farmer groups, or land plots",

    # Pricing & Market
    "Please explain your pricing strategy",
    "Revenue Model",
    "Sustainability of the Business",
    "Strength of Business Model",
    "Market size",
    "Total Addressable Market",
    "Go-to-market Strategy",
    "Prior Govt. Collaboration",

    # Pilot Design
    "Proposed Project Duration",
    "Total Project Cost",
    "Workplan & Milestones",
    "Risk Assessment & Mitigation",
    "Training & Capacity-Building Plan",
    "Training & Capacity\u2011Building Plan",
    "Output expected through this project",
    "Proposed Project Districts",
    "Please specify the baseline values",

    # Team
    "Founders Background",
    "Core Team and Leadership",

    # Compliance
    "Describe how the solution ensures compliance with data governance",
    "DPDP Act",
    "practices do you use to evaluate model safety",
    "Does your project incorporate any open-source technologies",

    # Inclusion
    "Gender and Social Inclusion Plan",

    # Strategic
    "Strategic impact on Maharashtra",

    # Declaration
    "We confirm the accuracy",
]

# Simplified label patterns for fuzzy matching
_FIELD_PATTERNS: list[tuple[str, re.Pattern]] = []

for field in AIAIC_FORM_FIELDS:
    # Build a regex that allows minor variations (whitespace, punctuation)
    escaped = re.escape(field)
    # Allow flexible whitespace/hyphens between words
    flexible = re.sub(r"\\ ", r"[\\s\\-–]+", escaped)
    flexible = re.sub(r"\\\.", r"\\.?", flexible)
    _FIELD_PATTERNS.append(
        (field, re.compile(flexible, re.IGNORECASE))
    )


# =============================================================================
# Indian number format handling
# =============================================================================

_INDIAN_NUMBER_RE = re.compile(
    r"(?:₹|INR|Rs\.?)\s*"          # optional currency prefix
    r"(\d{1,3}(?:,\d{2})*(?:,\d{3})?)"  # Indian-format number
    r"(?:\s*(?:crore|lakh|cr|L))?"  # optional unit suffix
)

_PLAIN_INDIAN_NUMBER_RE = re.compile(
    r"\b(\d{1,3}(?:,\d{2})*(?:,\d{3}))\b"
)


def normalize_indian_number(text: str) -> str:
    """Convert Indian number format (13,22,50,000) to integer string."""
    return text.replace(",", "")


def extract_financial_numbers(text: str) -> list[dict]:
    """Extract financial numbers with context from text."""
    results = []
    for match in _INDIAN_NUMBER_RE.finditer(text):
        raw = match.group(1)
        normalized = normalize_indian_number(raw)
        # Get surrounding context
        start = max(0, match.start() - 50)
        end = min(len(text), match.end() + 20)
        context = text[start:end].strip()
        results.append({
            "raw": match.group(0),
            "value": normalized,
            "numeric": int(normalized) if normalized.isdigit() else 0,
            "context": context,
        })
    return results


# =============================================================================
# Q&A pattern detection
# =============================================================================

def _detect_qa_pairs(text: str) -> list[dict]:
    """
    Detect Question-Answer pairs in AIAIC-style form text.

    AIAIC forms have a pattern where a question label appears on one or more
    lines, followed by the answer text. Questions are typically:
    - Short phrases ending with ? or )
    - Known field names from AIAIC_FORM_FIELDS
    - Text before a line break followed by longer answer text
    """
    lines = text.split("\n")
    qa_pairs: list[dict] = []
    current_question: Optional[str] = None
    current_answer_lines: list[str] = []
    current_match_field: Optional[str] = None

    def _flush():
        nonlocal current_question, current_answer_lines, current_match_field
        if current_question and current_answer_lines:
            answer = "\n".join(current_answer_lines).strip()
            if answer:
                qa_pairs.append({
                    "field_name": current_match_field or current_question,
                    "question": current_question,
                    "answer": answer,
                })
        current_question = None
        current_answer_lines = []
        current_match_field = None

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Check if this line matches a known field label
        matched_field = None
        for field_name, pattern in _FIELD_PATTERNS:
            if pattern.search(stripped):
                matched_field = field_name
                break

        # Heuristics for question detection:
        is_question = False

        if matched_field:
            is_question = True
        elif stripped.endswith("?") and len(stripped) < 300:
            is_question = True
        elif stripped.endswith(")") and len(stripped) < 200 and len(stripped.split()) <= 30:
            is_question = True
        elif (
            len(stripped) < 120
            and len(stripped.split()) <= 15
            and not stripped[0].isdigit()
            and stripped[0].isupper()
            and not stripped.endswith(".")
        ):
            # Short title-case lines without period endings are likely labels
            # But check they're not answers that happen to be short
            if any(kw in stripped.lower() for kw in [
                "name", "email", "address", "state", "website", "stage",
                "status", "level", "model", "plan", "strategy", "no.",
                "registration", "gstin", "cin", "employees",
            ]):
                is_question = True

        if is_question:
            _flush()
            current_question = stripped
            current_match_field = matched_field
        else:
            if current_question is not None:
                current_answer_lines.append(stripped)
            else:
                # Content before first question — treat as preamble
                # We still capture it as an implicit field
                if not qa_pairs and stripped:
                    current_question = "Preamble"
                    current_answer_lines.append(stripped)

    _flush()

    return qa_pairs


# =============================================================================
# Inline table reconstruction
# =============================================================================

def _detect_inline_table(text: str) -> Optional[dict]:
    """
    Detect tabular data rendered as inline text.

    Common patterns in AIAIC PDFs:
    - Pipe-separated: "Name | Role | Qualification | Experience"
    - Tab-separated columns that appear as spaces
    - Repeated structure across consecutive lines
    """
    lines = text.strip().split("\n")
    if len(lines) < 2:
        return None

    # Strategy 1: Pipe-separated table detection
    pipe_lines = [l for l in lines if "|" in l or " | " in l]
    if len(pipe_lines) >= 2:
        rows = []
        for line in pipe_lines:
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if cells:
                rows.append(cells)

        if rows and len(rows) >= 2:
            # Normalize column count to the most common
            col_counts = [len(r) for r in rows]
            most_common_cols = max(set(col_counts), key=col_counts.count)
            normalized_rows = [r for r in rows if len(r) == most_common_cols]

            if len(normalized_rows) >= 2:
                return {
                    "headers": normalized_rows[0],
                    "rows": normalized_rows[1:],
                    "raw_text": "\n".join(pipe_lines),
                }

    # Strategy 2: Aligned column detection
    # Look for lines with consistent column positions (tab/space aligned)
    if len(lines) >= 3:
        # Check if lines have consistent "word boundary" positions
        word_boundaries: list[list[int]] = []
        for line in lines:
            boundaries = []
            in_word = False
            for i, ch in enumerate(line):
                if ch != " " and not in_word:
                    boundaries.append(i)
                    in_word = True
                elif ch == " ":
                    in_word = False
            word_boundaries.append(boundaries)

        # Find common column start positions
        if len(word_boundaries) >= 3:
            all_positions = set()
            for wb in word_boundaries:
                all_positions.update(wb)

            # Positions that appear in >60% of lines are likely column starts
            position_counts: dict[int, int] = {}
            for wb in word_boundaries:
                for pos in wb:
                    # Allow +/- 2 char tolerance
                    matched = False
                    for existing in position_counts:
                        if abs(existing - pos) <= 2:
                            position_counts[existing] += 1
                            matched = True
                            break
                    if not matched:
                        position_counts[pos] = 1

            threshold = len(lines) * 0.5
            column_positions = sorted(
                pos for pos, count in position_counts.items()
                if count >= threshold
            )

            if len(column_positions) >= 3:
                # We have a table — split each line at column positions
                rows = []
                for line in lines:
                    cells = []
                    for i, pos in enumerate(column_positions):
                        end = column_positions[i + 1] if i + 1 < len(column_positions) else len(line)
                        cell = line[pos:end].strip()
                        cells.append(cell)
                    if any(c for c in cells):
                        rows.append(cells)

                if len(rows) >= 2:
                    return {
                        "headers": rows[0],
                        "rows": rows[1:],
                        "raw_text": text,
                    }

    return None


def reconstruct_team_table(text: str) -> list[dict]:
    """
    Reconstruct the team/founders table that often spans multiple pages.

    AIAIC team tables typically have: Name, Role, Qualification, Experience,
    LinkedIn, Expertise columns spread across pages as free text.
    """
    team_members = []

    # Look for LinkedIn URLs as anchors for team members
    linkedin_pattern = re.compile(r"(https?://(?:www\.)?linkedin\.com/\S+)")
    linkedin_matches = list(linkedin_pattern.finditer(text))

    if linkedin_matches:
        # Use LinkedIn URLs to anchor team member blocks
        for i, match in enumerate(linkedin_matches):
            # Get text before this LinkedIn URL (up to previous URL or start)
            start = linkedin_matches[i - 1].end() if i > 0 else 0
            block = text[start:match.end()].strip()

            member = _parse_team_member_block(block)
            if member:
                member["linkedin"] = match.group(1)
                team_members.append(member)
    else:
        # Fallback: try to detect team member blocks by name patterns
        blocks = re.split(r"\n(?=[A-Z][a-z]+ [A-Z])", text)
        for block in blocks:
            member = _parse_team_member_block(block.strip())
            if member and member.get("name"):
                team_members.append(member)

    return team_members


def _parse_team_member_block(block: str) -> Optional[dict]:
    """Parse a block of text into a team member dict."""
    if not block or len(block) < 10:
        return None

    lines = [l.strip() for l in block.split("\n") if l.strip()]
    if not lines:
        return None

    member: dict = {
        "name": "",
        "role": "",
        "qualification": "",
        "experience": "",
        "expertise": "",
    }

    # First non-empty line is likely the name
    if lines:
        potential_name = lines[0].strip()
        # Names are typically 2-5 words, no numbers
        if (
            2 <= len(potential_name.split()) <= 6
            and not any(c.isdigit() for c in potential_name)
            and len(potential_name) < 60
        ):
            member["name"] = potential_name

    # Look for role, qualification, experience in remaining text
    remaining = " ".join(lines[1:]) if len(lines) > 1 else ""

    # Experience years
    exp_match = re.search(r"(\d+)\+?\s*(?:years?|yrs?)", remaining, re.IGNORECASE)
    if exp_match:
        member["experience"] = exp_match.group(0)

    # Qualifications
    qual_patterns = [
        r"(?:Ph\.?D|M\.?Tech|B\.?Tech|MBA|M\.?Sc|B\.?Sc|M\.?S\.|B\.?E\.?)",
        r"(?:IIT|IIM|NIT|BITS|Stanford|MIT|Harvard|Cambridge)",
    ]
    for pat in qual_patterns:
        qual_match = re.search(pat, remaining, re.IGNORECASE)
        if qual_match:
            member["qualification"] = (
                member["qualification"] + " " + qual_match.group(0)
            ).strip()

    # Expertise keywords
    expertise_keywords = [
        "AI/ML", "Machine Learning", "Deep Learning", "Computer Vision",
        "NLP", "Data Science", "Agronomy", "Agriculture", "Remote Sensing",
        "IoT", "Satellite", "GIS", "Product", "Engineering", "Business",
    ]
    found_expertise = [
        kw for kw in expertise_keywords if kw.lower() in remaining.lower()
    ]
    if found_expertise:
        member["expertise"] = ", ".join(found_expertise)

    # Role — often the second line or contains keywords
    role_keywords = [
        "CEO", "CTO", "COO", "CFO", "Founder", "Co-founder",
        "Director", "Lead", "Head", "Manager", "Advisor",
        "Chief", "Officer", "VP", "President",
    ]
    for line in lines[1:4]:
        for kw in role_keywords:
            if kw.lower() in line.lower():
                member["role"] = line.strip()
                break
        if member["role"]:
            break

    return member if member.get("name") else None


# =============================================================================
# Main extraction function
# =============================================================================

def extract_form_fields(
    full_text: str,
    pages: Optional[list[dict]] = None,
) -> dict:
    """
    Extract structured form fields from an AIAIC-style proposal.

    Args:
        full_text: The full document text.
        pages: Optional per-page text dicts for multi-page merging.

    Returns:
        Dict with:
        - fields: {field_name: answer_text} mapping
        - tables_found: list of reconstructed tables
        - financial_numbers: extracted financial figures
        - team_members: extracted team data
        - completeness: fraction of expected fields found
    """
    logger.info("extracting_form_fields", text_length=len(full_text))

    # Step 1: Detect Q&A pairs
    qa_pairs = _detect_qa_pairs(full_text)
    logger.info("qa_pairs_detected", count=len(qa_pairs))

    # Step 2: Build field map
    fields: dict[str, str] = {}
    for qa in qa_pairs:
        field_name = qa["field_name"]
        answer = qa["answer"]
        # If we already have this field, append (multi-part answers)
        if field_name in fields:
            fields[field_name] += "\n" + answer
        else:
            fields[field_name] = answer

    # Step 3: Look for inline tables
    tables_found = []
    for qa in qa_pairs:
        table = _detect_inline_table(qa["answer"])
        if table:
            table["source_field"] = qa["field_name"]
            tables_found.append(table)

    # Step 4: Extract team data
    team_text_candidates = []
    for field_name, answer in fields.items():
        if any(kw in field_name.lower() for kw in [
            "team", "founder", "leadership", "core team",
        ]):
            team_text_candidates.append(answer)

    team_members = []
    for candidate in team_text_candidates:
        members = reconstruct_team_table(candidate)
        team_members.extend(members)

    # Step 5: Extract financial numbers
    financial_numbers = extract_financial_numbers(full_text)

    # Step 6: Calculate completeness
    key_fields = [
        "Solution Synopsis", "TRL Level", "IP Status",
        "Current Customers/Pilots", "Proposed Project Duration",
        "Total Project Cost", "Revenue Model", "Go-to-market Strategy",
        "Unique Value Proposition", "Risk Assessment & Mitigation",
        "Training & Capacity-Building Plan", "Gender and Social Inclusion Plan",
        "Strategic impact on Maharashtra",
    ]

    found_count = 0
    for key_field in key_fields:
        for actual_field in fields:
            if key_field.lower() in actual_field.lower():
                found_count += 1
                break

    completeness = found_count / len(key_fields) if key_fields else 0.0

    logger.info(
        "form_fields_extracted",
        total_fields=len(fields),
        tables=len(tables_found),
        team_members=len(team_members),
        financial_numbers=len(financial_numbers),
        completeness=round(completeness, 2),
    )

    return {
        "fields": fields,
        "tables_found": tables_found,
        "financial_numbers": financial_numbers,
        "team_members": team_members,
        "completeness": completeness,
        "qa_pairs_count": len(qa_pairs),
    }
