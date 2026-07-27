"""
Metadata agent — derives an idea's identity from its document.

This runs on EVERY ingested document, whether or not it is ever evaluated. That is
a requirement in its own right: "in any case we need to generate metadata to know
about the idea, so save that metadata for each idea with an evaluated-or-not flag."

Its output is what the rest of the system keys off:
  * `company_name`  -> interned into `companies`, which is how we count how many
                       ideas a company has already had approved (requirement e).
  * `category`      -> interned into `categories`. NOT chosen from a fixed list —
                       the client was explicit that categories are not predefined,
                       so the model proposes a category and we mint it if it is new
                       (requirement d).
  * `title`/`problem`/`solution`/`theme`
                    -> composed into the embedding used for duplicate detection
                       (requirement h), and shown to the admin when comparing two
                       similar ideas.

Runs on the small/fast model. Pulling structured fields out of text that has already
been sectioned is not a task that needs the 70B model, and reserving the big model's
tokens-per-minute budget for the judgment agents is what lets them run in parallel.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from app.services.llm.llm_client import LLMError, get_llm_client
from app.utils.logging import get_logger
from app.utils.tokens import truncate_to_tokens

logger = get_logger(__name__)

SYSTEM_PROMPT = """You are a metadata extractor for agricultural startup proposals \
submitted to a government innovation challenge.

Read the proposal and extract its identity. Report ONLY what the document actually \
says. If a field is genuinely absent, use null — never invent a plausible value, and \
never carry a value over from your general knowledge of the company.

Return JSON with exactly these keys:

{
  "title": "Short name of the proposed project or product (not the company name).",
  "company_name": "Legal or trading name of the organisation submitting. Exactly as written.",
  "contact_email": "Contact email if stated, else null.",
  "website": "Company website if stated, else null.",
  "year_incorporated": "Year of incorporation as a 4-digit integer, else null.",

  "category": "The SINGLE best category for this idea, as a short noun phrase of 2-4 \
words describing the agricultural problem domain it addresses. Examples of the FORM \
expected (do not just copy these): 'Precision Irrigation', 'Livestock Health \
Monitoring', 'Crop Disease Detection', 'Farm Credit Access', 'Post-Harvest Storage', \
'Soil Nutrient Management'. Choose the category that describes WHAT AGRICULTURAL \
PROBLEM the idea solves — not the technology it uses. Two ideas that both use \
computer vision but one detects pests and the other grades produce are in DIFFERENT \
categories.",

  "secondary_categories": ["Up to 2 further categories, same form. [] if none."],

  "theme": "One sentence: what this idea is, in plain language.",
  "problem_statement": "2-3 sentences on the problem it addresses, per the document.",
  "solution_summary": "2-3 sentences on the proposed solution, per the document.",

  "target_beneficiaries": "Who benefits (e.g. smallholder farmers, FPOs), else null.",
  "technology_used": ["Key technologies named in the document. [] if none stated."],
  "trl_level": "Technology Readiness Level as an integer 1-9 if stated, else null.",
  "districts": ["Districts or regions named for deployment. [] if none."],

  "confidence": 0.0
}

`confidence` is your 0.0-1.0 confidence that you identified the company and category \
correctly. Be honest: a scanned document with poor OCR should score low."""


class MetadataAgent:
    """Extracts an idea's identity. One fast LLM call."""

    name = "MetadataAgent"

    # The identity of an idea lives in its opening pages and its problem/solution
    # sections. Sending the whole document (budget tables, compliance annexure and
    # all) would cost several times the tokens to produce the same six fields.
    #
    # The hard ceiling is the fast model's per-minute budget, which Groq charges as
    # (input + max_tokens). On the free tier that is 6,000, so:
    #     system prompt (~800) + input (3,000) + max_tokens (1,200) = ~5,000
    # leaves headroom. An earlier 6,000-token input produced a 7,273-token request
    # and a hard 413 that no retry could ever clear.
    MAX_INPUT_TOKENS = 3000
    MAX_OUTPUT_TOKENS = 1200

    async def extract(
        self,
        *,
        sections: Optional[dict[str, str]] = None,
        full_text: str = "",
        filename: str = "",
    ) -> dict[str, Any]:
        """
        Returns the metadata dict. Never raises: a metadata failure must not lose the
        document, because the row and the stored original still have to exist so an
        operator can retry.
        """
        start = time.time()
        content = self._build_input(sections or {}, full_text, filename)

        if not content.strip():
            return self._empty("No text could be extracted from the document.")

        try:
            llm = get_llm_client()
            response = await llm.chat(
                system_prompt=SYSTEM_PROMPT,
                user_content=content,
                # Near-deterministic: this is extraction, not judgment. A creative
                # temperature here invents company names.
                temperature=0.1,
                max_tokens=self.MAX_OUTPUT_TOKENS,
                fast=True,
            )

            result = self._normalize(response["result"])
            result["_tokens"] = response["tokens"]
            result["_duration_ms"] = int((time.time() - start) * 1000)
            result["_model"] = response["model"]

            logger.info(
                "metadata_extracted",
                company=result.get("company_name"),
                category=result.get("category"),
                confidence=result.get("confidence"),
                tokens=response["tokens"],
            )
            return result

        except LLMError as exc:
            logger.warning("metadata_extraction_failed", error=str(exc))
            return self._empty(str(exc))
        except Exception as exc:
            logger.error("metadata_agent_error", error=str(exc))
            return self._empty(str(exc))

    def _build_input(
        self, sections: dict[str, str], full_text: str, filename: str
    ) -> str:
        """
        Assemble the smallest input that can answer the question.

        Identity comes from the applicant-identity section; substance comes from
        problem/solution/vision. Everything else (budget tables, workplans,
        compliance) is irrelevant to *what this idea is* and is left out.
        """
        parts = [f"Filename: {filename}"] if filename else []

        wanted = ("identity", "vision", "problem", "solution", "business_model")
        for key in wanted:
            text = sections.get(key)
            if text and text.strip():
                parts.append(f"=== {key.upper()} ===\n{text.strip()}")

        # No usable sections (e.g. a plain .txt, or sectioning found nothing) —
        # fall back to the head of the document, where the cover page lives.
        if len(parts) <= 1 and full_text.strip():
            parts.append(f"=== DOCUMENT ===\n{full_text[:12000]}")

        return truncate_to_tokens("\n\n".join(parts), self.MAX_INPUT_TOKENS)

    def _normalize(self, raw: dict) -> dict[str, Any]:
        """Coerce the model's output into the shape the database expects."""

        def clean_str(value: Any) -> Optional[str]:
            if value is None:
                return None
            text = str(value).strip()
            # Models like to say "N/A" or "Not specified" instead of returning null.
            if not text or text.lower() in {
                "n/a", "na", "none", "null", "not specified",
                "not stated", "unknown", "not found", "-",
            }:
                return None
            return text

        def clean_list(value: Any) -> list[str]:
            if not isinstance(value, list):
                return []
            return [s for s in (clean_str(v) for v in value) if s]

        def clean_int(value: Any) -> Optional[int]:
            try:
                return int(str(value).strip())
            except (TypeError, ValueError):
                return None

        try:
            confidence = float(raw.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0

        trl = clean_int(raw.get("trl_level"))
        if trl is not None and not 1 <= trl <= 9:
            trl = None

        return {
            "title": clean_str(raw.get("title")),
            "company_name": clean_str(raw.get("company_name")),
            "contact_email": clean_str(raw.get("contact_email")),
            "website": clean_str(raw.get("website")),
            "year_incorporated": clean_int(raw.get("year_incorporated")),
            "category": clean_str(raw.get("category")),
            "secondary_categories": clean_list(raw.get("secondary_categories"))[:2],
            "theme": clean_str(raw.get("theme")),
            "problem_statement": clean_str(raw.get("problem_statement")),
            "solution_summary": clean_str(raw.get("solution_summary")),
            "target_beneficiaries": clean_str(raw.get("target_beneficiaries")),
            "technology_used": clean_list(raw.get("technology_used")),
            "trl_level": trl,
            "districts": clean_list(raw.get("districts")),
            "confidence": max(0.0, min(1.0, confidence)),
            "error": None,
        }

    def _empty(self, error: str) -> dict[str, Any]:
        """
        A metadata failure still produces a row.

        The document is stored, the proposal exists, the error is recorded, and an
        operator can retry it. Losing the upload because one LLM call failed would
        be exactly the "marked successful after upload only" failure mode the client
        complained about, inverted.
        """
        return {
            "title": None,
            "company_name": None,
            "contact_email": None,
            "website": None,
            "year_incorporated": None,
            "category": None,
            "secondary_categories": [],
            "theme": None,
            "problem_statement": None,
            "solution_summary": None,
            "target_beneficiaries": None,
            "technology_used": [],
            "trl_level": None,
            "districts": [],
            "confidence": 0.0,
            "error": error,
        }


metadata_agent = MetadataAgent()
