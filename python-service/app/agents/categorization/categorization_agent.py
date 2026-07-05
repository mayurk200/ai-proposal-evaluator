"""
Categorization Agent — Phase 2.

Reads a proposal's extracted text and produces a structured, all-information
record: title, summary, problem/solution, technologies, target beneficiaries,
geography, stage, agri categories, keywords, a quick triage rank, and flags.

It does NOT score or evaluate the proposal — that is a later phase. Its one hard
rule: every category must be strictly agriculture-related. If a document is not
about agriculture, it is marked out of scope rather than tagged with a non-agri
category.
"""

import time
from typing import Optional

from app.config import AGRI_CATEGORY_TAXONOMY
from app.models.schemas import CategorizationFlags, CategorizationResult
from app.services.llm.llm_client import get_llm_client
from app.utils.logging import get_logger

logger = get_logger(__name__)

MAX_CONTENT_CHARS = 30000
MIN_TEXT_CHARS = 40
MAX_CATEGORIES = 8


class CategorizationAgent:
    """Turns extracted proposal text into a structured agri-categorized record."""

    name = "CategorizationAgent"
    temperature = 0.2
    max_tokens = 2048

    def __init__(
        self,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ):
        if temperature is not None:
            self.temperature = temperature
        if max_tokens is not None:
            self.max_tokens = max_tokens

    @property
    def system_prompt(self) -> str:
        taxonomy = "\n".join(f"- {c}" for c in AGRI_CATEGORY_TAXONOMY)
        return f"""You are a categorization agent for an AGRICULTURE innovation programme.

You are given the extracted text of a startup/project proposal. Read ALL of it and
produce a single JSON object that captures the key information about the proposal
and tags it with one or more AGRICULTURE categories.

You DO NOT score, rate, or evaluate the quality of the proposal. You only describe
and categorize it. (Scoring happens in a later stage.)

## HARD RULES ON CATEGORIES
- Every category MUST be strictly agriculture-related (crop, farm, farmer, soil,
  irrigation, livestock, aquaculture, agri supply chain, agri-fintech, agri policy,
  rural/agri sustainability, etc.).
- A proposal may have MULTIPLE categories.
- Prefer categories from this curated list (use the exact slug):
{taxonomy}
- If none of the above fits, you MAY add a new category, but it MUST still be
  agriculture-related and written as a short lowercase kebab-case slug
  (e.g. "vertical-farming"). NEVER output a non-agriculture category.
- If the document is clearly NOT about agriculture, set "agri_relevance" to false,
  set "categories" to [], and set flags.out_of_scope to true.

## RANK
"rank" is a quick 0-100 triage signal of how complete/promising the proposal looks
at a glance (data present, clarity, ambition). It is NOT a formal evaluation score —
keep it rough.

## OUTPUT — return ONLY this JSON object, no prose:
{{
  "title": "<concise project/product title>",
  "summary": "<3-5 sentence plain-language summary>",
  "problem_statement": "<the problem the proposal addresses>",
  "proposed_solution": "<the proposed solution/approach>",
  "technologies": ["<tech/tools used, e.g. IoT, computer-vision, LLM>"],
  "target_beneficiaries": ["<who benefits, e.g. smallholder farmers>"],
  "geography": "<region/state/country focus, or empty>",
  "stage": "<one of: idea | pilot | scaling>",
  "categories": ["<agri category slug>", "..."],
  "keywords": ["<salient keywords>"],
  "agri_relevance": true,
  "rank": <0-100 integer>,
  "confidence": <0.0-1.0>,
  "flags": {{
    "agri_relevant": true,
    "needs_review": false,
    "insufficient_text": false,
    "out_of_scope": false
  }}
}}"""

    async def categorize(
        self,
        content: str,
        metadata: Optional[dict] = None,
    ) -> CategorizationResult:
        """Run categorization on extracted text and return a structured result."""
        start = time.time()
        text = (content or "").strip()

        if len(text) < MIN_TEXT_CHARS:
            logger.warning("categorization_insufficient_text", chars=len(text))
            return CategorizationResult(
                agri_relevance=False,
                flags=CategorizationFlags(
                    insufficient_text=True, needs_review=True, agri_relevant=False
                ),
            )

        user_content = self._build_user_content(text, metadata)
        llm = get_llm_client()

        # llm.chat is synchronous (mirrors the evaluation agents' usage).
        response = llm.chat(
            system_prompt=self.system_prompt,
            user_content=user_content,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
        parsed = self._parse(response.get("result", {}))

        logger.info(
            "categorization_completed",
            categories=parsed.categories,
            rank=parsed.rank,
            agri_relevant=parsed.agri_relevance,
            tokens=response.get("tokens", 0),
            duration_ms=int((time.time() - start) * 1000),
        )
        return parsed

    def _build_user_content(self, text: str, metadata: Optional[dict]) -> str:
        parts: list[str] = []
        if metadata:
            parts.append("Document metadata:")
            parts.append(f"- Filename: {metadata.get('filename', 'unknown')}")
            sections = metadata.get("detected_sections")
            if sections:
                parts.append(f"- Sections: {', '.join(sections)}")
            parts.append("")
        parts.append("Proposal text:")
        parts.append(text[:MAX_CONTENT_CHARS])
        if len(text) > MAX_CONTENT_CHARS:
            parts.append("\n... [truncated due to size limits] ...")
        return "\n".join(parts)

    def _parse(self, result: dict) -> CategorizationResult:
        """Coerce and validate the raw LLM JSON into a CategorizationResult."""
        if not isinstance(result, dict) or result.get("error"):
            return CategorizationResult(
                flags=CategorizationFlags(needs_review=True)
            )

        categories = self._sanitize_categories(_as_list(result.get("categories")))
        agri_relevance = _as_bool(result.get("agri_relevance"), default=True)

        rank = _as_int(result.get("rank"), default=0)
        rank = max(0, min(100, rank))

        confidence = _as_float(result.get("confidence"), default=0.0)
        confidence = max(0.0, min(1.0, confidence))

        flags_in = result.get("flags") if isinstance(result.get("flags"), dict) else {}
        flags = CategorizationFlags(
            agri_relevant=_as_bool(flags_in.get("agri_relevant"), default=agri_relevance),
            needs_review=_as_bool(flags_in.get("needs_review"), default=False) or not categories,
            insufficient_text=_as_bool(flags_in.get("insufficient_text"), default=False),
            out_of_scope=_as_bool(flags_in.get("out_of_scope"), default=not agri_relevance),
        )

        return CategorizationResult(
            title=str(result.get("title", "")).strip(),
            summary=str(result.get("summary", "")).strip(),
            problem_statement=str(result.get("problem_statement", "")).strip(),
            proposed_solution=str(result.get("proposed_solution", "")).strip(),
            technologies=_as_list(result.get("technologies")),
            target_beneficiaries=_as_list(result.get("target_beneficiaries")),
            geography=str(result.get("geography", "")).strip(),
            stage=str(result.get("stage", "")).strip().lower(),
            categories=categories,
            keywords=_as_list(result.get("keywords")),
            agri_relevance=agri_relevance,
            rank=rank,
            confidence=confidence,
            flags=flags,
        )

    @staticmethod
    def _sanitize_categories(cats: list[str]) -> list[str]:
        """Normalize category strings to stable kebab-case slugs; dedupe; cap."""
        seen: set[str] = set()
        out: list[str] = []
        for c in cats:
            slug = "-".join(
                part for part in c.strip().lower().replace("_", "-").replace(" ", "-").split("-") if part
            )
            if slug and slug not in seen:
                seen.add(slug)
                out.append(slug)
        return out[:MAX_CATEGORIES]


def _as_list(value) -> list[str]:
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _as_bool(value, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    if value is None:
        return default
    return bool(value)


def _as_int(value, default: int = 0) -> int:
    try:
        return int(round(float(value)))
    except (ValueError, TypeError):
        return default


def _as_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (ValueError, TypeError):
        return default
