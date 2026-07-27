"""
Base class for the seven parameter agents.

Two things changed, and they are the point of Phase 3.

**Routing.** An agent no longer receives the whole document and keyword-scans it.
It declares which SECTIONS it needs (`sections`), and the orchestrator hands it
exactly those. The finance agent gets the financial and business-model sections; it
never sees the vision statement. Besides being far cheaper, this removes a real
correctness bug: the old filter used naive substring matching, so `"ip" in text`
matched inside "DIPP", "equipment" and "recipient", and agents were routinely fed
text that had nothing to do with them.

**Evidence.** Every sub-score must carry a verbatim quote from the document, or be
declared unevidenced. The old agents produced a number and a paragraph of prose
with no traceable link to the source, which made a score impossible to audit — and
made it impossible to distinguish "the proposal addressed this badly" from "the
proposal never mentioned this", because both came out as a low number.

An agent that is given no relevant sections at all is `starved`: it does not run,
does not cost a token, and does not invent a score.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from app.config import settings
from app.models.schemas import AgentResult, Citation, SubQuestionResult
from app.services.llm.llm_client import LLMError, get_llm_client
from app.utils.logging import get_logger
from app.utils.tokens import count_tokens, truncate_to_tokens

logger = get_logger(__name__)


# The contract every parameter agent's prompt inherits. This is where requirement
# (b) is actually enforced — not as a suggestion, but as the output schema.
EVIDENCE_CONTRACT = """
You are scoring one parameter of an agricultural startup proposal for a government
innovation challenge. You will be shown ONLY the sections of the proposal relevant
to your parameter.

THE RULES OF EVIDENCE — these are absolute:

1. Every score you give MUST be justified by a VERBATIM quote from the text you were
   shown. Copy the quote exactly. Do not paraphrase it, do not clean it up, do not
   reconstruct it from memory.

2. If the text you were shown does NOT address a sub-question, you MUST return:
       "evidence_found": false, "score": null
   Do NOT score it 0. A score of 0 means "they addressed this and it is very poor".
   `null` means "they did not address this". These are different findings and the
   evaluator needs to tell them apart.

3. Never use outside knowledge about the company, its founders, or its products.
   If you happen to recognise the company, ignore what you know. Score the document
   in front of you, not the company's reputation.

4. Do not reward confident language. A vague claim stated forcefully ("we will
   revolutionise Indian agriculture") is weak evidence. A specific, checkable claim
   ("deployed with 1,240 farmers across 3 districts in Nashik") is strong evidence.
   Score what is substantiated, not what is asserted.

Return JSON in exactly this shape:

{
  "sub_questions": [
    {
      "question_id": "the id given to you",
      "score": 7.5,                    // 0-10, or null if unevidenced
      "evidence_found": true,
      "citations": [
        {"quote": "verbatim text copied from the proposal", "section": "financial"}
      ],
      "justification": "Why this score follows from those quotes."
    }
  ],
  "analysis": "2-4 sentences assessing this parameter overall, grounded in the citations.",
  "key_findings": ["Concrete findings, each traceable to a citation."],
  "red_flags": ["Specific concerns. [] if none. Do not invent concerns to seem rigorous."],
  "recommendations": ["What the applicant would need to supply or fix."],
  "confidence": 0.8                    // 0-1: how well the text supported a judgement
}
"""


class BaseAgent:
    """Scores one AIAIC parameter from the sections routed to it."""

    # --- subclasses define these -------------------------------------------
    name: str = "BaseAgent"
    parameter_key: str = ""
    parameter_label: str = ""
    # Which document sections this agent needs, most important first. These are
    # sectioniser keys.
    sections: tuple[str, ...] = ()
    # The questions it must answer. Each becomes a scored, cited sub-question.
    questions: tuple[tuple[str, str], ...] = ()   # (question_id, question text)
    role_prompt: str = ""

    temperature: float = 0.2   # Judgment, not creativity.

    def __init__(
        self,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ):
        if temperature is not None:
            self.temperature = temperature

        # Sized to fit inside one TPM budget alongside the system prompt. Groq counts
        # (input + max_tokens) against the per-minute allowance, so an agent whose
        # context and output ceiling together exceed the budget gets a hard 413 that
        # no retry can fix — it does not matter how patient we are.
        self.max_tokens = max_tokens or settings.LLM_AGENT_MAX_TOKENS
        self.MAX_CONTEXT_TOKENS = settings.LLM_AGENT_CONTEXT_TOKENS

    # ------------------------------------------------------------------
    # Prompt assembly
    # ------------------------------------------------------------------

    @property
    def system_prompt(self) -> str:
        questions_block = "\n".join(
            f'  - id "{qid}": {text}' for qid, text in self.questions
        )
        return (
            f"{self.role_prompt.strip()}\n\n"
            f"You must answer each of these sub-questions, using its exact id:\n"
            f"{questions_block}\n"
            f"{EVIDENCE_CONTRACT}"
        )

    def build_context(self, sections: dict[str, str]) -> tuple[str, list[str]]:
        """
        Assemble this agent's view of the document.

        Returns (context, sections_actually_used). Sections are added in the order
        the agent declared them, so if we have to truncate, the least relevant
        section is what gets cut — not an arbitrary tail of the document.
        """
        parts: list[str] = []
        used: list[str] = []
        budget = self.MAX_CONTEXT_TOKENS

        for key in self.sections:
            text = (sections.get(key) or "").strip()
            if not text:
                continue

            block = f"=== SECTION: {key} ===\n{text}"
            cost = count_tokens(block)

            if cost > budget:
                # Take what fits rather than dropping the section wholesale — a
                # truncated financial section still beats no financial section.
                if budget > 500:
                    parts.append(truncate_to_tokens(block, budget))
                    used.append(key)
                break

            parts.append(block)
            used.append(key)
            budget -= cost

        return "\n\n".join(parts), used

    # ------------------------------------------------------------------
    # Run
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_for_match(text: str) -> str:
        """
        Collapse the differences that do not change what a quote *says*.

        A model copying a quote out of a PDF will silently normalise a non-breaking
        space, straighten a curly apostrophe, or turn an en-dash into a hyphen. Those
        are not fabrications and must not be treated as such, so we compare on a
        canonical form: lowercase, ASCII-folded punctuation, single-spaced.
        """
        folded = (
            text.lower()
            .replace("’", "'").replace("‘", "'")
            .replace("“", '"').replace("”", '"')
            .replace("–", "-").replace("—", "-")
            .replace(" ", " ")
        )
        return " ".join(folded.split())

    def _verify_citations(
        self, citations: list[Citation], context: str
    ) -> list[Citation]:
        """
        Keep only the quotes that actually appear in the text the agent was shown.

        This is what makes requirement (b) a guarantee rather than an aspiration. An
        LLM asked for a verbatim quote will, under pressure, produce a *plausible*
        one — a sentence the document could have contained. A score justified by a
        sentence that was never written is worse than an unjustified score, because
        it looks auditable and is not.

        Anything we cannot find in the source is dropped. If that leaves a
        sub-question with no citations at all, it is downgraded to unevidenced by the
        caller — the model does not get to keep the score without the evidence.
        """
        if not citations:
            return []

        haystack = self._normalize_for_match(context)
        verified: list[Citation] = []

        for citation in citations:
            needle = self._normalize_for_match(citation.quote)
            if not needle:
                continue

            if needle in haystack:
                verified.append(citation)
                continue

            # Long quotes are often stitched from two nearby passages, or trail off
            # with an ellipsis. Accept one if a substantial, distinctive opening
            # fragment is genuinely present — that is a real anchor into the document,
            # not an invention.
            probe = needle[:80]
            if len(probe) >= 40 and probe in haystack:
                verified.append(citation)
                continue

            logger.warning(
                "citation_not_grounded",
                agent=self.name,
                quote=citation.quote[:100],
            )

        return verified

    async def analyze(self, sections: dict[str, str]) -> AgentResult:
        """Score this parameter from the routed sections."""
        start = time.time()

        context, used = self.build_context(sections)

        if not context.strip():
            # The document contains nothing this agent could judge. Say so, and
            # spend nothing. The old code would have sent it a fallback slice of
            # unrelated text and let it produce a confident low score from it.
            logger.info("agent_starved", agent=self.name, wanted=list(self.sections))
            return AgentResult(
                agent_name=self.name,
                parameter_key=self.parameter_key,
                score=None,
                starved=True,
                sections_seen=[],
                status="success",
                analysis=(
                    f"The proposal contains no content addressing {self.parameter_label}. "
                    "No score can be given without evidence."
                ),
                sub_questions=[
                    SubQuestionResult(
                        question_id=qid,
                        question=text,
                        score=None,
                        evidence_found=False,
                        justification="The proposal does not address this.",
                    )
                    for qid, text in self.questions
                ],
            )

        try:
            response = await get_llm_client().chat(
                system_prompt=self.system_prompt,
                user_content=context,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            raw = response["result"]

            # Citations are checked against the exact text this agent was shown. A
            # score whose evidence cannot be found in the source does not survive.
            sub_questions = self._parse_sub_questions(raw, context)
            score = self._aggregate(sub_questions)

            result = AgentResult(
                agent_name=self.name,
                parameter_key=self.parameter_key,
                score=score,
                confidence=_clamp(raw.get("confidence", 0.0), 0.0, 1.0),
                analysis=str(raw.get("analysis", "")),
                key_findings=_str_list(raw.get("key_findings")),
                red_flags=_str_list(raw.get("red_flags")),
                recommendations=_str_list(raw.get("recommendations")),
                sub_questions=sub_questions,
                sections_seen=used,
                raw_output=raw,
                tokens_used=response["tokens"],
                duration_ms=int((time.time() - start) * 1000),
                status="success",
            )

            logger.info(
                "agent_completed",
                agent=self.name,
                score=score,
                evidenced=result.evidenced_count,
                of=len(sub_questions),
                sections=used,
                tokens=response["tokens"],
            )
            return result

        except (LLMError, Exception) as exc:
            logger.error("agent_failed", agent=self.name, error=str(exc))
            # A failed agent scores None, not 0 — we do not know that this parameter
            # is bad, we know that we failed to assess it. Averaging a 0 in here
            # would quietly punish the applicant for our outage.
            return AgentResult(
                agent_name=self.name,
                parameter_key=self.parameter_key,
                score=None,
                sections_seen=used,
                analysis=f"This parameter could not be evaluated: {exc}",
                duration_ms=int((time.time() - start) * 1000),
                status="failed",
                error=str(exc),
            )

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def _parse_sub_questions(
        self, raw: dict, context: str
    ) -> list[SubQuestionResult]:
        """
        Turn the model's output into sub-question results, keyed on the questions we
        actually asked.

        Driven by OUR question list, not the model's — if the model skips a question
        or invents one, we still return exactly the questions this parameter is
        defined by. A missing answer becomes 'unevidenced', which is the truthful
        reading of "the model did not answer it".
        """
        by_id: dict[str, dict] = {}
        for item in raw.get("sub_questions") or []:
            if isinstance(item, dict) and item.get("question_id"):
                by_id[str(item["question_id"])] = item

        results: list[SubQuestionResult] = []
        for qid, text in self.questions:
            answer = by_id.get(qid)

            if not answer:
                results.append(
                    SubQuestionResult(
                        question_id=qid,
                        question=text,
                        score=None,
                        evidence_found=False,
                        justification="Not addressed in the proposal.",
                    )
                )
                continue

            citations = self._verify_citations(
                self._parse_citations(answer.get("citations")), context
            )
            evidence_found = bool(answer.get("evidence_found")) and bool(citations)

            # A score without a citation is exactly the thing requirement (b) forbids.
            # If the model claims a score but supplies no quote to back it, we do not
            # trust the score — we record it as unevidenced.
            score = None
            if evidence_found:
                raw_score = answer.get("score")
                if raw_score is not None:
                    try:
                        score = _clamp(float(raw_score), 0.0, 10.0)
                    except (TypeError, ValueError):
                        score = None

            results.append(
                SubQuestionResult(
                    question_id=qid,
                    question=text,
                    score=score,
                    evidence_found=evidence_found and score is not None,
                    citations=citations,
                    justification=str(answer.get("justification", "")),
                )
            )

        return results

    def _parse_citations(self, raw: Any) -> list[Citation]:
        if not isinstance(raw, list):
            return []

        citations: list[Citation] = []
        for item in raw:
            if isinstance(item, dict):
                quote = str(item.get("quote", "")).strip()
                section = str(item.get("section", "")).strip()
            elif isinstance(item, str):
                quote, section = item.strip(), ""
            else:
                continue

            # A one-word "quote" is not evidence of anything.
            if len(quote) < 10:
                continue

            citations.append(Citation(quote=quote[:1200], section=section))

        return citations[:5]

    def _aggregate(self, sub_questions: list[SubQuestionResult]) -> Optional[float]:
        """
        Parameter score = mean of the EVIDENCED sub-scores, scaled to 0-100.

        Unevidenced sub-questions are skipped, not counted as zero. Scoring a
        proposal down for a question it was never asked to answer — or that the
        model failed to find an answer to — would make the score a measure of
        document completeness rather than of merit. If nothing at all was
        evidenced, the parameter has no score.
        """
        scored = [sq.score for sq in sub_questions if sq.evidence_found and sq.score is not None]
        if not scored:
            return None
        return round(sum(scored) / len(scored) * 10.0, 2)


def _clamp(value: Any, low: float, high: float) -> float:
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return low


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()][:10]
