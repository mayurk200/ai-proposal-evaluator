"""
Debate agent — cross-parameter conflict detection.

Runs only when the parameter scores actually disagree with each other in a way worth
resolving. The previous implementation had an elaborate `should_trigger` that computed
score variance, checked borderline bands and looked for named conflict patterns... and
then ended with an unconditional `return True`. Every check was dead code: debate ran on
every single evaluation, costing one large LLM call each time, and the diagnostics only
ever explained *why* something that was going to happen anyway was happening.

The trigger is now real. On a proposal whose parameters agree with one another there is
nothing to debate, and we skip the call.

What it looks for is the case where two parameters cannot both be true:

  * A venture with a strong revenue model whose farmers cannot afford the product.
  * Mature technology (high TRL) with no evidence of any field deployment.
  * An ambitious pilot with a team that has never delivered one.

These are exactly the contradictions a weighted average hides — both parameters score
respectably, and the average looks fine, while the combination is fatal.
"""

from __future__ import annotations

import statistics
import time
from typing import Optional

from app.agents.parameters import PARAMETER_LABELS
from app.models.schemas import AgentResult, DebateResult
from app.services.llm.llm_client import LLMError, get_llm_client
from app.utils.logging import get_logger
from app.utils.tokens import truncate_to_tokens

logger = get_logger(__name__)

# Spread (in points) between the highest and lowest parameter score above which the
# assessment is internally inconsistent enough to be worth a second look.
SPREAD_THRESHOLD = 30.0

# A red flag raised under a parameter that nonetheless scored well is a contradiction
# in itself: the assessor found something alarming and scored around it.
HIGH_SCORE_WITH_FLAG = 70.0

# Pairs that routinely contradict each other, as (parameter_a, parameter_b, why).
# Checked only when one scores high and the other low.
CONFLICT_PAIRS: tuple[tuple[str, str, str], ...] = (
    (
        "scaleup",
        "farmer_adoption",
        "A strong commercial model that farmers cannot afford or access does not scale — "
        "it just prices out the beneficiary.",
    ),
    (
        "solution_readiness",
        "pilot_design",
        "Mature technology paired with a weak pilot plan suggests the applicant has built "
        "something but has not worked out how to put it in a field.",
    ),
    (
        "pilot_design",
        "team_capacity",
        "An ambitious pilot proposed by a team with no evidence of having delivered one is "
        "a delivery risk the pilot score alone will not show.",
    ),
    (
        "solution_readiness",
        "problem_relevance",
        "Sophisticated technology attached to a weakly-defined problem is the classic "
        "solution-in-search-of-a-problem.",
    ),
)

GAP = 25.0  # How far apart a conflict pair must be to count.


SYSTEM_PROMPT = """You are reviewing an assessment of an agricultural startup proposal in
which the specialist assessors have reached findings that appear to CONFLICT with one
another.

You are shown their scores, their cited evidence and the specific tensions detected. You
are NOT shown the company's identity, and you are NOT shown the proposal itself.

Your job is to decide, for each conflict, whether it is real and what it means. A conflict
is real when two findings cannot both be true, or when their combination undermines the
proposal in a way neither score captures alone. It is NOT real when the two findings are
simply about different things and both can hold.

Be conservative. Do not manufacture a conflict to look thorough, and do not adjust a score
without a reason you can state in one sentence.

Return JSON:

{
  "conflicts": [
    {
      "parameters": ["scaleup", "farmer_adoption"],
      "description": "What the contradiction actually is, in plain language.",
      "real": true,
      "resolution": "Which finding should carry more weight, and why."
    }
  ],
  "adjusted_scores": {"scaleup": 58.0},
  "high_ambiguity_areas": ["Areas where the evidence genuinely does not settle the question."],
  "confidence": 0.7
}

`adjusted_scores` may contain 0-100 values for parameters you believe are wrong in light of
the conflict. Include a parameter ONLY if you are changing it. Leave the object empty if
nothing should move."""


class DebateAgent:
    """Detects and resolves contradictions between parameter assessments."""

    name = "DebateAgent"
    temperature = 0.2
    max_tokens = 1500
    MAX_CONTEXT_TOKENS = 4000

    def should_trigger(
        self, results: dict[str, AgentResult]
    ) -> tuple[bool, list[str]]:
        """
        Decide whether there is anything to debate, and say why.

        Returns (trigger, reasons). Unlike its predecessor, this can — and often does —
        return False, which saves a large LLM call on every proposal whose assessment is
        internally consistent.
        """
        scored = {
            key: result.score
            for key, result in results.items()
            if result.score is not None and result.status == "success"
        }

        # With fewer than three scored parameters there is not enough of an assessment
        # to have an internal contradiction.
        if len(scored) < 3:
            return False, []

        reasons: list[str] = []
        values = list(scored.values())

        spread = max(values) - min(values)
        if spread > SPREAD_THRESHOLD:
            high = max(scored, key=lambda k: scored[k])
            low = min(scored, key=lambda k: scored[k])
            reasons.append(
                f"Scores are {spread:.0f} points apart — "
                f"{PARAMETER_LABELS.get(high, high)} ({scored[high]:.0f}) vs "
                f"{PARAMETER_LABELS.get(low, low)} ({scored[low]:.0f})."
            )

        for key, result in results.items():
            if (
                result.score is not None
                and result.score >= HIGH_SCORE_WITH_FLAG
                and result.red_flags
            ):
                reasons.append(
                    f"{PARAMETER_LABELS.get(key, key)} scored {result.score:.0f} but the "
                    f"assessor still raised a red flag: {result.red_flags[0][:120]}"
                )

        for a, b, why in CONFLICT_PAIRS:
            if a not in scored or b not in scored:
                continue
            if scored[a] - scored[b] >= GAP:
                reasons.append(
                    f"{PARAMETER_LABELS.get(a, a)} ({scored[a]:.0f}) far exceeds "
                    f"{PARAMETER_LABELS.get(b, b)} ({scored[b]:.0f}). {why}"
                )
            elif scored[b] - scored[a] >= GAP:
                reasons.append(
                    f"{PARAMETER_LABELS.get(b, b)} ({scored[b]:.0f}) far exceeds "
                    f"{PARAMETER_LABELS.get(a, a)} ({scored[a]:.0f}). {why}"
                )

        if reasons:
            return True, reasons

        logger.info(
            "debate_skipped",
            reason="assessment is internally consistent",
            spread=round(spread, 1),
            stdev=round(statistics.pstdev(values), 1) if len(values) > 1 else 0.0,
        )
        return False, []

    async def analyze(
        self, results: dict[str, AgentResult]
    ) -> tuple[Optional[DebateResult], int]:
        """Returns (debate_result, tokens). None when no debate was warranted."""
        trigger, reasons = self.should_trigger(results)
        if not trigger:
            return None, 0

        start = time.time()
        logger.info("debate_triggered", reasons=len(reasons))

        try:
            response = await get_llm_client().chat(
                system_prompt=SYSTEM_PROMPT,
                user_content=self._render(results, reasons),
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            raw = response["result"]

            # Only keep conflicts the model affirmed as real — it is explicitly allowed
            # to dismiss a detected tension, and we should honour that.
            conflicts = [
                c
                for c in (raw.get("conflicts") or [])
                if isinstance(c, dict) and c.get("real")
            ]

            adjusted: dict[str, float] = {}
            for key, value in (raw.get("adjusted_scores") or {}).items():
                if key not in results:
                    continue
                try:
                    adjusted[key] = max(0.0, min(100.0, float(value)))
                except (TypeError, ValueError):
                    continue

            result = DebateResult(
                triggered=True,
                trigger_reasons=reasons,
                conflicts=conflicts,
                debates=raw.get("debates") or [],
                adjusted_scores=adjusted,
                high_ambiguity_areas=[
                    str(a) for a in (raw.get("high_ambiguity_areas") or [])
                ][:6],
                confidence=max(0.0, min(1.0, float(raw.get("confidence", 0.0) or 0.0))),
            )

            logger.info(
                "debate_completed",
                conflicts_real=len(conflicts),
                adjustments=len(adjusted),
                seconds=round(time.time() - start, 2),
            )
            return result, response["tokens"]

        except (LLMError, Exception) as exc:
            # Debate is an enhancement, not a requirement. If it fails we still have
            # seven evidenced parameter scores, so we record the tensions we detected
            # deterministically and carry on.
            logger.warning("debate_failed", error=str(exc))
            return (
                DebateResult(
                    triggered=True,
                    trigger_reasons=reasons,
                    confidence=0.0,
                ),
                0,
            )

    def _render(self, results: dict[str, AgentResult], reasons: list[str]) -> str:
        """The assessors' findings plus the detected tensions. No company, no document."""
        lines = ["=== TENSIONS DETECTED ==="]
        lines.extend(f"  - {r}" for r in reasons)
        lines.append("\n=== ASSESSOR FINDINGS ===")

        for key, result in results.items():
            if result.score is None:
                continue
            lines.append(
                f"\n--- {PARAMETER_LABELS.get(key, key)}: {result.score}/100 "
                f"(confidence {result.confidence:.0%})"
            )
            if result.analysis:
                lines.append(f"  {result.analysis[:400]}")

            for finding in result.key_findings[:3]:
                lines.append(f"  + {finding[:180]}")
            for flag in result.red_flags[:3]:
                lines.append(f"  ! {flag[:180]}")

            # The strongest quote behind this score, so the model can weigh the actual
            # evidence rather than only the number.
            best = max(
                (sq for sq in result.sub_questions if sq.evidence_found and sq.citations),
                key=lambda sq: sq.score or 0.0,
                default=None,
            )
            if best and best.citations:
                lines.append(f'  evidence: "{best.citations[0].quote[:220]}"')

        return truncate_to_tokens("\n".join(lines), self.MAX_CONTEXT_TOKENS)


debate_agent = DebateAgent()
