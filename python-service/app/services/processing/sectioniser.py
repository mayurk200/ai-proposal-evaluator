"""
Split an extracted document into labelled sections.

This is the component requirement (h) turns on: "the extracted text is split into
the sections that the doc contains — financial info, scalability, business model,
vision, feasibility — and agents evaluate each section", so that a finance agent
is never handed the vision statement and our calls stay cheap.

How it works
------------
Extraction has already emitted `## Heading` markers (from PDF font size, DOCX
styles, PPTX titles), so the document arrives pre-cut into heading-delimited
blocks. Each block is then labelled with a section type by a two-tier classifier:

  Tier 1 — deterministic keyword scoring on the *heading*. Headings in these forms
    are field labels ("Revenue Model", "Founders Background", "DPDP Compliance"),
    so when a keyword hits the heading it is a very strong signal and we take it.
    Costs nothing.

  Tier 2 — semantic similarity, for blocks whose heading is uninformative
    ("Details", "Annexure 2", "Response"). The block is embedded and compared
    against a description of each section type. This is what catches the paragraph
    about affordability that never says the word "pricing" — which a keyword list
    structurally cannot.

No LLM call is made here. Sectioning a 100-page document costs zero tokens.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from app.services.embeddings.embedder import cosine_similarity, embed_texts
from app.utils.logging import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class SectionType:
    """A canonical section of an agri-startup proposal."""

    key: str
    label: str
    # Prose description, embedded once and compared against ambiguous blocks.
    description: str
    # High-signal words. Matched against the heading with word boundaries — the old
    # keyword filter used naive substring matching, so "ip" matched inside "DIPP"
    # and "equipment", and the compliance agent was fed irrelevant text.
    keywords: tuple[str, ...]


SECTION_TYPES: tuple[SectionType, ...] = (
    SectionType(
        key="identity",
        label="Applicant Identity",
        description=(
            "Administrative identification of the applicant: name of the contact "
            "person, email address, phone and contact number, postal address, "
            "website, startup or company name, entity type, registration number, "
            "year of incorporation, CIN and DIPP number."
        ),
        keywords=(
            "name", "email", "contact", "phone", "mobile", "address", "website",
            "entity", "type", "registration", "incorporation", "cin", "dipp",
            "startup name", "company name", "applicant", "authorized person",
            "application track",
        ),
    ),
    SectionType(
        key="problem",
        label="Problem & Relevance",
        description=(
            "The agricultural problem being solved, the pain points farmers face, "
            "the need and its relevance to farmers, districts and the region."
        ),
        keywords=(
            "problem", "challenge", "pain point", "need", "relevance", "context",
            "background", "motivation", "issue",
        ),
    ),
    SectionType(
        key="solution",
        label="Solution & Technology Readiness",
        description=(
            "The proposed solution, the technology and technical approach, models "
            "and algorithms, data sources, technology readiness level, patents and "
            "intellectual property, prototypes and product maturity."
        ),
        keywords=(
            "solution", "technology", "technical", "innovation", "trl", "readiness",
            "product", "platform", "architecture", "algorithm", "model", "patent",
            "intellectual property", "prototype", "data source", "approach",
        ),
    ),
    SectionType(
        key="pilot",
        label="Pilot Design & Feasibility",
        description=(
            "The pilot plan and its feasibility: workplan, milestones, timeline, "
            "deliverables, project duration, districts covered, implementation "
            "approach, risks and mitigation, and the project budget and cost."
        ),
        keywords=(
            "pilot", "workplan", "work plan", "milestone", "timeline", "schedule",
            "deliverable", "implementation", "deployment", "rollout", "duration",
            "risk", "mitigation", "feasibility", "district", "phase",
        ),
    ),
    SectionType(
        key="financial",
        label="Financial Information",
        description=(
            "Financial detail: project cost, budget breakdown, funding required and "
            "raised, unit economics, margins, capital expenditure, revenue figures, "
            "valuation and financial projections."
        ),
        keywords=(
            "financial", "budget", "cost", "funding", "investment", "capital",
            "expenditure", "unit economics", "margin", "valuation", "projection",
            "grant", "fund", "expense", "outlay",
        ),
    ),
    SectionType(
        key="business_model",
        label="Business Model & Scale-up",
        description=(
            "How the venture makes money and grows: revenue model, pricing, "
            "go-to-market strategy, market size, customers, traction, partnerships, "
            "scalability and commercial sustainability."
        ),
        keywords=(
            "business model", "revenue", "pricing", "price", "market", "customer",
            "traction", "go-to-market", "gtm", "commercial", "monetisation",
            "monetization", "scale", "scalability", "scale-up", "growth",
            "sustainability", "partnership", "sales",
        ),
    ),
    SectionType(
        key="adoption",
        label="Farmer Adoption & Inclusion",
        description=(
            "How farmers actually adopt and benefit: farmer benefits, affordability, "
            "training and capacity building, extension support, gender and social "
            "inclusion, number of farmers reached, and behaviour change."
        ),
        keywords=(
            "farmer", "adoption", "beneficiary", "benefit", "affordability",
            "training", "capacity building", "extension", "gender", "inclusion",
            "women", "youth", "smallholder", "outreach", "awareness",
        ),
    ),
    SectionType(
        key="team",
        label="Team & Capacity",
        description=(
            "The people: founders and their background, core team, employees, "
            "advisors, organisational capacity, credentials, prior experience and "
            "track record."
        ),
        keywords=(
            "team", "founder", "co-founder", "employee", "staff", "personnel",
            "leadership", "management", "advisor", "credential", "qualification",
            "experience", "background", "organisation", "organization", "cv",
            "resume", "profile",
        ),
    ),
    SectionType(
        key="compliance",
        label="Compliance & Governance",
        description=(
            "Legal and ethical posture: data protection and DPDP Act compliance, "
            "data governance and privacy, model safety and responsible AI, "
            "certifications, regulatory approvals and standards."
        ),
        keywords=(
            "compliance", "dpdp", "privacy", "data protection", "governance",
            "regulation", "regulatory", "legal", "certification", "standard",
            "ethic", "safety", "responsible ai", "consent", "security", "audit",
        ),
    ),
    SectionType(
        key="vision",
        label="Vision & Impact",
        description=(
            "The bigger picture: vision, mission, long-term goals, expected impact "
            "and outcomes, strategic significance and the change the venture intends "
            "to bring about."
        ),
        keywords=(
            "vision", "mission", "objective", "goal", "aim", "impact", "outcome",
            "strategic", "significance", "purpose", "about us", "overview",
            "executive summary", "introduction", "synopsis",
        ),
    ),
)

SECTION_KEYS: tuple[str, ...] = tuple(s.key for s in SECTION_TYPES)
_BY_KEY = {s.key: s for s in SECTION_TYPES}

# `identity` is a real section of the document, but no scoring agent should ever
# receive it: an applicant's email address is not evidence for or against their
# pilot design. It is captured because the metadata extractor wants it (company
# name, contact, incorporation year), and then excluded from agent dispatch.
# Everything else is scoreable.
SCOREABLE_SECTION_KEYS: tuple[str, ...] = tuple(
    k for k in SECTION_KEYS if k != "identity"
)

# A block this short has a heading but essentially no body — a form field like
# "Email: x@y.com". Embedding it produces a near-meaningless vector that lands in
# whichever section happens to be closest, which is how "Email" ended up
# classified as the problem statement. These go to `identity` unless a keyword
# says otherwise.
MIN_BODY_CHARS_FOR_SEMANTIC = 120

# Word-boundary patterns, compiled once. Multi-word keywords keep their spaces.
_KEYWORD_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    section.key: [
        re.compile(rf"\b{re.escape(kw)}\b", re.IGNORECASE) for kw in section.keywords
    ]
    for section in SECTION_TYPES
}

_HEADING_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)

# Below this cosine score, the semantic classifier is not confident enough to
# assign a specific section and the block is filed under `vision` (the general
# bucket) rather than being force-fitted somewhere misleading.
MIN_SEMANTIC_CONFIDENCE = 0.30

# Blocks shorter than this carry no evidence worth routing.
MIN_BLOCK_CHARS = 40


@dataclass
class Block:
    """One heading-delimited span of the document."""

    heading: str
    text: str
    start: int
    end: int
    section_key: str = ""
    confidence: float = 0.0
    method: str = ""  # "keyword" | "semantic" | "default"


@dataclass
class Section:
    """All the blocks that belong to one canonical section."""

    key: str
    label: str
    blocks: list[Block] = field(default_factory=list)

    @property
    def text(self) -> str:
        parts = []
        for block in self.blocks:
            if block.heading:
                parts.append(f"## {block.heading}\n{block.text}")
            else:
                parts.append(block.text)
        return "\n\n".join(parts)

    @property
    def char_count(self) -> int:
        return len(self.text)


def split_into_blocks(text: str) -> list[Block]:
    """Cut the document at its `## Heading` markers."""
    if not text.strip():
        return []

    matches = list(_HEADING_RE.finditer(text))

    if not matches:
        # No headings at all (a plain .txt, or a PDF whose typography gave nothing
        # away). Treat the whole document as one block; the semantic classifier
        # will still place it.
        return [Block(heading="", text=text.strip(), start=0, end=len(text))]

    blocks: list[Block] = []

    # Anything before the first heading is the preamble — usually the cover page
    # and abstract, which is real content and must not be dropped.
    preamble = text[: matches[0].start()].strip()
    if len(preamble) >= MIN_BLOCK_CHARS:
        blocks.append(
            Block(heading="", text=preamble, start=0, end=matches[0].start())
        )

    for i, match in enumerate(matches):
        heading = match.group(1).strip()
        body_start = match.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[body_start:body_end].strip()

        blocks.append(
            Block(heading=heading, text=body, start=match.start(), end=body_end)
        )

    return blocks


def _keyword_score(text: str, section_key: str) -> int:
    """Count distinct keyword hits for a section within `text`."""
    return sum(
        1 for pattern in _KEYWORD_PATTERNS[section_key] if pattern.search(text)
    )


def classify_by_keywords(block: Block) -> tuple[str, float]:
    """
    Tier 1: score the heading, then the body as a weaker signal.

    A hit in the heading is worth far more than a hit in the body — a heading that
    says "Revenue Model" *is* the business-model section, whereas the word "revenue"
    appearing once inside a paragraph about farmer training means very little.
    """
    scores: dict[str, float] = {}

    for key in SECTION_KEYS:
        heading_hits = _keyword_score(block.heading, key) if block.heading else 0
        # Only look at the head of the body: keywords near the top are topical,
        # keywords buried on page 4 of a block are usually incidental.
        body_hits = _keyword_score(block.text[:600], key)

        score = heading_hits * 3.0 + body_hits * 0.5
        if score > 0:
            scores[key] = score

    if not scores:
        return "", 0.0

    best = max(scores, key=lambda k: scores[k])
    best_score = scores[best]

    # Require a genuine heading match (>= 3.0) to short-circuit the semantic pass.
    # Body-only hits are too weak to trust on their own.
    if best_score >= 3.0:
        runner_up = sorted(scores.values(), reverse=True)[1] if len(scores) > 1 else 0.0
        # Confidence reflects how decisively this beat the alternatives.
        confidence = min(1.0, (best_score - runner_up) / max(best_score, 1.0) + 0.5)
        return best, confidence

    return "", 0.0


async def classify_by_semantics(blocks: list[Block]) -> None:
    """
    Tier 2: embed the ambiguous blocks and match them to the closest section type.

    Mutates `blocks` in place. Everything is embedded in ONE batch — per-block
    embedding calls would be an order of magnitude slower on a long document.
    """
    if not blocks:
        return

    section_descriptions = [f"{s.label}. {s.description}" for s in SECTION_TYPES]
    block_texts = [
        f"{b.heading}. {b.text[:1200]}" if b.heading else b.text[:1200] for b in blocks
    ]

    vectors = await embed_texts(section_descriptions + block_texts)
    section_vectors = vectors[: len(SECTION_TYPES)]
    block_vectors = vectors[len(SECTION_TYPES) :]

    for block, block_vector in zip(blocks, block_vectors):
        similarities = [
            cosine_similarity(block_vector, section_vector)
            for section_vector in section_vectors
        ]
        best_index = max(range(len(similarities)), key=lambda i: similarities[i])
        best_score = similarities[best_index]

        if best_score >= MIN_SEMANTIC_CONFIDENCE:
            block.section_key = SECTION_KEYS[best_index]
            block.confidence = round(best_score, 3)
            block.method = "semantic"
        else:
            # Genuinely unclassifiable. File it in the general bucket rather than
            # forcing it into a specific agent's evidence — an agent scoring against
            # text that isn't about its parameter is worse than an agent not seeing it.
            block.section_key = "vision"
            block.confidence = round(best_score, 3)
            block.method = "default"


async def sectionise(text: str) -> dict[str, Section]:
    """
    Split `text` into canonical sections.

    Returns only the sections the document actually contains — an absent section is
    absent, not an empty one, so an agent can be told "there is no financial section
    in this proposal" rather than being handed a blank and inventing a low score for
    it. That distinction is what requirement (b) — every score must cite its basis —
    depends on.
    """
    blocks = split_into_blocks(text)
    blocks = [b for b in blocks if len(b.text) >= MIN_BLOCK_CHARS or b.heading]

    if not blocks:
        return {}

    # Tier 1 on everything, then Tier 2 only on what is left over.
    ambiguous: list[Block] = []
    for block in blocks:
        key, confidence = classify_by_keywords(block)
        if key:
            block.section_key = key
            block.confidence = round(confidence, 3)
            block.method = "keyword"
        elif len(block.text) < MIN_BODY_CHARS_FOR_SEMANTIC:
            # Too little body to say anything meaningful about. Sending it to the
            # embedder would just assign it to the nearest section by chance, so
            # it is filed as identity/administrative and kept away from the agents.
            block.section_key = "identity"
            block.confidence = 0.0
            block.method = "too_short"
        else:
            ambiguous.append(block)

    if ambiguous:
        await classify_by_semantics(ambiguous)

    sections: dict[str, Section] = {}
    for block in blocks:
        if not block.section_key:
            continue
        section = sections.get(block.section_key)
        if section is None:
            spec = _BY_KEY[block.section_key]
            section = Section(key=spec.key, label=spec.label)
            sections[block.section_key] = section
        section.blocks.append(block)

    logger.info(
        "document_sectionised",
        blocks=len(blocks),
        sections=len(sections),
        by_keyword=sum(1 for b in blocks if b.method == "keyword"),
        by_semantic=sum(1 for b in blocks if b.method == "semantic"),
        too_short=sum(1 for b in blocks if b.method == "too_short"),
        defaulted=sum(1 for b in blocks if b.method == "default"),
        found=sorted(sections.keys()),
    )

    return sections


def scoreable_sections(sections: dict[str, Section]) -> dict[str, Section]:
    """
    The sections an agent may be shown.

    Excludes `identity` — contact details are not evidence about an idea's merit,
    and feeding them to seven agents would be seven times the tokens for zero
    signal.
    """
    return {k: v for k, v in sections.items() if k in SCOREABLE_SECTION_KEYS}


def sections_to_json(sections: dict[str, Section]) -> dict:
    """Serialize sections for the `proposals.sections` JSONB column."""
    return {
        key: {
            "label": section.label,
            "char_count": section.char_count,
            "block_count": len(section.blocks),
            "headings": [b.heading for b in section.blocks if b.heading],
            "text": section.text,
        }
        for key, section in sections.items()
    }


def sections_from_json(payload: Optional[dict]) -> dict[str, str]:
    """Rehydrate `{section_key: text}` from the stored JSONB. Used on re-evaluation
    so we never re-read the source document."""
    if not payload:
        return {}
    return {
        key: value.get("text", "")
        for key, value in payload.items()
        if isinstance(value, dict) and value.get("text")
    }
