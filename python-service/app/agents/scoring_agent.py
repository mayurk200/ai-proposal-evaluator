"""
Final synthesis — the "unbiased result" agent.

The client asked: "at last all is evaluated by an agent (here what can be done to get
best unbiased results)". This is the answer, and it is mostly about what this agent is
NOT allowed to see.

Three deliberate blinds:

1. **It never sees the company.** No name, no founders, no website, no filename. A
   model that recognises a well-known agritech brand carries opinions about it from
   its training data, and those opinions would leak into a government funding
   decision. It sees seven parameter scores and the quotes that justified them.

2. **It never sees the raw document.** If it could re-read the proposal it would
   re-judge it, silently overriding the specialist assessors with a shallower
   whole-document impression — and the evidence discipline they applied would be lost.
   It reasons over their findings, not over the source.

3. **The arithmetic is not its job.** The weighted score is computed deterministically
   in Python BEFORE the model is called, and the model is told what it is. An LLM asked
   to compute a weighted average produces a plausible number, not a correct one, and it
   drifts between runs. The model's job is judgment — the recommendation, the SWOT, the
   risks — not multiplication.

The model may adjust the computed score, but only within a bounded band and only with a
stated reason. Anything wider would make the deterministic weighting decorative.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from app.agents.parameters import PARAMETER_LABELS, WEIGHTS
from app.models.enums import RecommendationLevel, RiskLevel
from app.models.schemas import (
    AgentResult,
    DebateResult,
    FinalEvaluation,
    ParameterResult,
    SWOTAnalysis,
)
from app.services.llm.llm_client import LLMError, get_llm_client
from app.utils.logging import get_logger
from app.utils.tokens import truncate_to_tokens

logger = get_logger(__name__)

# How far the model may move the deterministic weighted score, in points. Wide enough
# to express "the parts are worse than their sum" (strong tech, no route to farmers),
# narrow enough that the weights still govern the outcome.
MAX_ADJUSTMENT = 8.0


SYSTEM_PROMPT = """You are the final reviewer for a government agricultural innovation
challenge. Seven specialist assessors have each scored one parameter of a proposal, and
every score is backed by verbatim quotes from the document.

You will NOT be told which company submitted this, and you will NOT be shown the
proposal itself. This is deliberate. Judge the assessment in front of you.

You are given a WEIGHTED SCORE that has already been computed arithmetically from the
parameter scores and their official weights. That arithmetic is correct — do not
recompute it. You may adjust it by at most 8 points in either direction, and only if the
parameters interact in a way a weighted average cannot capture. Legitimate reasons:

  - A fatal dependency: e.g. the technology is strong, but nothing indicates farmers can
    afford or access it, so the pilot cannot deliver whatever the tech score says.
  - Compounding weakness: several mid scores sharing one root cause.
  - Compounding strength: evidence under one parameter that corroborates another.

Do NOT adjust merely because the score feels too harsh or too generous. If you adjust,
state the reason.

Where a parameter is marked UNEVIDENCED, the proposal did not address it at all. Treat
that as a gap in the application and say so — but do not score it as though the applicant
had answered badly. "Did not answer" and "answered poorly" are different findings.

Return JSON:

{
  "adjusted_score": 63.5,
  "adjustment_reason": "",
  "recommendation": "Highly Recommended" | "Recommended" | "Conditionally Recommended" | "Not Recommended",
  "risk_level": "Low" | "Medium" | "High",
  "investment_readiness": "One sentence on readiness for pilot funding.",

  "summary": "3-5 sentences: what this proposal is, its strongest evidenced claim, its most serious gap, and what the decision hinges on.",

  "swot": {
    "strengths": ["..."],
    "weaknesses": ["..."],
    "opportunities": ["..."],
    "threats": ["..."],
    "narrative": "A CONTINUOUS 4-6 sentence assessment that reads as a single argument, joining the four quadrants: what this proposal has going for it, what undermines it, what it could become, and what could kill it. Finish every sentence. Do not trail off, do not stop mid-thought, and do not end on a fragment."
  },

  "unsupported_claims": ["Claims the assessors flagged as asserted but not evidenced. [] if none."],
  "key_action_items": ["What the applicant must supply or fix, most important first."]
}"""


class ScoringAgent:
    """Deterministic weighting + blind LLM synthesis."""

    name = "FinalScoringAgent"
    temperature = 0.2
    max_tokens = 2000

    # The blind context grows with the number of citations, so on a well-evidenced
    # proposal it could otherwise drift past the per-minute token budget. Cap it: the
    # citations are ordered by parameter, so truncation drops the lowest-weighted
    # detail rather than anything structural.
    MAX_CONTEXT_TOKENS = 6000

    async def synthesize(
        self,
        *,
        agent_results: dict[str, AgentResult],
        debate_result: Optional[DebateResult] = None,
    ) -> tuple[FinalEvaluation, int]:
        """
        Returns (evaluation, tokens_used).

        Never raises. If the LLM call fails we still return a real, defensible score,
        because the deterministic weighting has already produced one — losing the
        synthesis costs us the prose, not the evaluation.
        """
        start = time.time()

        breakdown = self._build_breakdown(agent_results)
        weighted, coverage, unevidenced, failed = self._weighted_score(breakdown)

        if failed:
            logger.warning(
                "evaluation_is_partial",
                failed_parameters=failed,
                note="these were not assessed by us; they are NOT applicant gaps",
            )

        try:
            response = await get_llm_client().chat(
                system_prompt=SYSTEM_PROMPT,
                user_content=self._render_blind_context(
                    breakdown, weighted, coverage, unevidenced, failed, debate_result
                ),
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            raw = response["result"]
            tokens = response["tokens"]

            final_score = self._apply_adjustment(weighted, raw)

            evaluation = FinalEvaluation(
                overall_score=final_score,
                recommendation=self._recommendation(raw.get("recommendation"), final_score),
                risk_level=self._risk(raw.get("risk_level")),
                investment_readiness=str(raw.get("investment_readiness", "")),
                summary=str(raw.get("summary", "")),
                swot_analysis=self._swot(raw.get("swot")),
                unsupported_claims=_str_list(raw.get("unsupported_claims")),
                key_action_items=_str_list(raw.get("key_action_items")),
                unevidenced_parameters=unevidenced,
                failed_parameters=failed,
                evidence_coverage=coverage,
                parameter_breakdown=breakdown,
                debate_summary=debate_result,
            )

        except (LLMError, Exception) as exc:
            logger.error("scoring_synthesis_failed", error=str(exc))
            evaluation = FinalEvaluation(
                overall_score=weighted,
                recommendation=self._recommendation(None, weighted),
                risk_level=RiskLevel.MEDIUM.value,
                summary=(
                    "The parameter scores below were computed from the cited evidence, but "
                    f"the final narrative synthesis could not be generated ({exc}). The "
                    "score itself is unaffected."
                ),
                unevidenced_parameters=unevidenced,
                failed_parameters=failed,
                evidence_coverage=coverage,
                parameter_breakdown=breakdown,
                debate_summary=debate_result,
            )
            tokens = 0

        # Lift the per-parameter scores to the top level for cheap sorting/filtering.
        for key, param in breakdown.items():
            field = f"{key}_score"
            if hasattr(evaluation, field):
                setattr(evaluation, field, param.parameter_score)

        evaluation.strengths = evaluation.swot_analysis.strengths[:5]
        evaluation.weaknesses = evaluation.swot_analysis.weaknesses[:5]

        logger.info(
            "scoring_completed",
            weighted=weighted,
            final=evaluation.overall_score,
            recommendation=evaluation.recommendation,
            coverage=coverage,
            seconds=round(time.time() - start, 2),
        )
        return evaluation, tokens

    # ------------------------------------------------------------------
    # Deterministic part
    # ------------------------------------------------------------------

    def _build_breakdown(
        self, agent_results: dict[str, AgentResult]
    ) -> dict[str, ParameterResult]:
        breakdown: dict[str, ParameterResult] = {}

        for result in agent_results.values():
            key = result.parameter_key
            if key not in WEIGHTS:
                continue

            # Three distinct outcomes, and the difference matters enormously:
            #   scored      — we assessed it.
            #   unevidenced — the proposal does not address it. About the APPLICANT.
            #   failed      — our agent broke. About US, and never the applicant's fault.
            if result.status == "failed":
                status = "failed"
            elif result.score is None:
                status = "unevidenced"
            else:
                status = "scored"

            asked = len(result.sub_questions) or 1
            breakdown[key] = ParameterResult(
                parameter_name=PARAMETER_LABELS.get(key, key),
                parameter_key=key,
                parameter_score=result.score,
                weight=WEIGHTS[key],
                status=status,
                error=result.error,
                sub_questions=result.sub_questions,
                key_findings=result.key_findings,
                red_flags=result.red_flags,
                recommendations=result.recommendations,
                sections_seen=result.sections_seen,
                evidence_coverage=round(result.evidenced_count / asked, 3),
            )

        return breakdown

    def _weighted_score(
        self, breakdown: dict[str, ParameterResult]
    ) -> tuple[float, float, list[str], list[str]]:
        """
        Weighted mean over the parameters that HAVE a score.

        Returns (weighted, coverage, unevidenced, failed).

        Unscored parameters are excluded and the remaining weights renormalized rather
        than being counted as zero. Counting them as zero would mean a proposal that
        never mentions DPDP compliance (weight 5%) loses 5 points outright — which turns
        the overall score into a measure of how completely the form was filled in, not of
        the idea's merit.

        `unevidenced` and `failed` are reported SEPARATELY and must never be merged. A
        parameter the proposal did not address is a finding about the applicant. A
        parameter our agent failed to assess is a fact about us — presenting it as
        "the proposal did not address this" would blame the applicant for our rate limit.
        """
        scored = {
            k: p
            for k, p in breakdown.items()
            if p.parameter_score is not None and p.status == "scored"
        }
        unevidenced = sorted(
            PARAMETER_LABELS.get(k, k)
            for k, p in breakdown.items()
            if p.status == "unevidenced"
        )
        failed = sorted(
            PARAMETER_LABELS.get(k, k)
            for k, p in breakdown.items()
            if p.status == "failed"
        )

        # Coverage measures how much of the document answered our questions, so a
        # parameter we never managed to ask about cannot count against it.
        assessable = [p for p in breakdown.values() if p.status != "failed"]
        total_sub = sum(len(p.sub_questions) for p in assessable)
        evidenced_sub = sum(
            sum(1 for sq in p.sub_questions if sq.evidence_found) for p in assessable
        )
        coverage = round(evidenced_sub / total_sub, 3) if total_sub else 0.0

        if not scored:
            return 0.0, coverage, unevidenced, failed

        total_weight = sum(p.weight for p in scored.values())
        weighted = (
            sum((p.parameter_score or 0.0) * p.weight for p in scored.values())
            / total_weight
        )

        return round(weighted, 2), coverage, unevidenced, failed

    def _apply_adjustment(self, weighted: float, raw: dict) -> float:
        """Let the model move the score, but only inside the band."""
        try:
            proposed = float(raw.get("adjusted_score", weighted))
        except (TypeError, ValueError):
            return weighted

        delta = proposed - weighted
        if abs(delta) > MAX_ADJUSTMENT:
            proposed = weighted + (MAX_ADJUSTMENT if delta > 0 else -MAX_ADJUSTMENT)
            logger.warning(
                "score_adjustment_clamped",
                weighted=weighted,
                model_proposed=round(float(raw.get("adjusted_score", weighted)), 2),
                applied=round(proposed, 2),
            )

        return round(max(0.0, min(100.0, proposed)), 2)

    # ------------------------------------------------------------------
    # The blind context
    # ------------------------------------------------------------------

    def _render_blind_context(
        self,
        breakdown: dict[str, ParameterResult],
        weighted: float,
        coverage: float,
        unevidenced: list[str],
        failed: list[str],
        debate: Optional[DebateResult],
    ) -> str:
        """
        Render the assessors' findings — and nothing that identifies the applicant.

        Everything here is drawn from AgentResults, which hold scores, quotes and
        findings. The company name, the filename and the raw document never enter this
        string. That is the blind.
        """
        lines = [
            "=== ASSESSMENT SUMMARY ===",
            f"Weighted score (already computed — do not recompute): {weighted}",
            f"Evidence coverage: {coverage:.0%} of sub-questions were answered by the document.",
        ]
        if unevidenced:
            lines.append(
                "Parameters the proposal did NOT address at all: " + ", ".join(unevidenced)
            )
        if failed:
            # The model must not read our outage as the applicant's silence and hold it
            # against them.
            lines.append(
                "Parameters that COULD NOT BE ASSESSED because of a technical failure on "
                "our side: " + ", ".join(failed) + ". This is NOT a gap in the proposal. "
                "Do not penalise the applicant for it. Note in your summary that the "
                "assessment is incomplete and should be re-run."
            )

        for param in breakdown.values():
            lines.append("")
            if param.status == "failed":
                score = "NOT ASSESSED — technical failure on our side, not a gap in the proposal"
            elif param.parameter_score is None:
                score = "UNEVIDENCED — the proposal did not address this"
            else:
                score = f"{param.parameter_score}/100"
            lines.append(f"--- {param.parameter_name} (weight {param.weight:.0%}): {score}")

            for sq in param.sub_questions:
                if sq.evidence_found and sq.score is not None:
                    lines.append(f"  [{sq.score}/10] {sq.question}")
                    for citation in sq.citations[:2]:
                        lines.append(f'      evidence: "{citation.quote[:280]}"')
                    if sq.justification:
                        lines.append(f"      reasoning: {sq.justification[:280]}")
                else:
                    lines.append(f"  [no evidence] {sq.question}")

            if param.red_flags:
                lines.append("  RED FLAGS: " + "; ".join(param.red_flags[:4]))

        if debate and debate.triggered and debate.conflicts:
            lines.append("\n=== CROSS-PARAMETER CONFLICTS FLAGGED ===")
            for conflict in debate.conflicts[:5]:
                description = (
                    conflict.get("description") if isinstance(conflict, dict) else str(conflict)
                )
                lines.append(f"  - {description}")

        return truncate_to_tokens("\n".join(lines), self.MAX_CONTEXT_TOKENS)

    # ------------------------------------------------------------------
    # Coercion
    # ------------------------------------------------------------------

    def _recommendation(self, value: Optional[str], score: float) -> str:
        valid = {r.value for r in RecommendationLevel}
        if value and str(value).strip() in valid:
            return str(value).strip()

        # Fall back to the score band when the model gives us nothing usable.
        if score >= 80:
            return RecommendationLevel.HIGHLY_RECOMMENDED.value
        if score >= 65:
            return RecommendationLevel.RECOMMENDED.value
        if score >= 45:
            return RecommendationLevel.CONDITIONALLY_RECOMMENDED.value
        return RecommendationLevel.NOT_RECOMMENDED.value

    def _risk(self, value: Optional[str]) -> str:
        valid = {r.value for r in RiskLevel}
        text = str(value).strip() if value else ""
        return text if text in valid else RiskLevel.MEDIUM.value

    def _swot(self, raw: Any) -> SWOTAnalysis:
        if not isinstance(raw, dict):
            return SWOTAnalysis()
        return SWOTAnalysis(
            strengths=_str_list(raw.get("strengths")),
            weaknesses=_str_list(raw.get("weaknesses")),
            opportunities=_str_list(raw.get("opportunities")),
            threats=_str_list(raw.get("threats")),
            narrative=str(raw.get("narrative", "")).strip(),
        )


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()][:8]


scoring_agent = ScoringAgent()
