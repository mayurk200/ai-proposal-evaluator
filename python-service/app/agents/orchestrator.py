"""
Evaluation orchestrator.

Pipeline:
    route sections -> 7 parameter agents (PARALLEL) -> debate (conditional) -> blind synthesis

The seven parameter agents are fully independent — none reads another's output — yet the
previous orchestrator ran them strictly one after another, because the LLM client was
synchronous and would have blocked the event loop anyway. With the async client in place
they run concurrently under a semaphore, which is the difference between an evaluation
taking ~7 sequential LLM calls of wall time and ~3.

Concurrency is bounded rather than unlimited: Groq bills per tokens-per-minute, and firing
all seven at once would trip the TPM ceiling and produce a cascade of 429s that the backoff
would then serialise anyway — slower than just pacing them in the first place.

The extraction agent is gone. It existed to pull ~30 structured fields out of the document
with a full LLM call, and its output was merged into the regex form fields to enrich the
context every later agent saw. That work is now done by the metadata agent at ingestion
(once, on the cheap model, persisted) and by section routing, so paying for it again on
every evaluation bought nothing.
"""

from __future__ import annotations

import asyncio
import time
from typing import Optional

from app.agents.debate_agent import debate_agent
from app.agents.parameters import PARAMETER_AGENTS
from app.agents.scoring_agent import scoring_agent
from app.config import settings
from app.models.enums import ProcessingStatus
from app.models.schemas import AgentResult, DebateResult, EvaluationResponse
from app.utils.logging import get_logger

logger = get_logger(__name__)


class AgentOrchestrator:
    """Runs the evaluation pipeline over a sectioned document."""

    def __init__(self) -> None:
        self.agents = [agent_cls() for agent_cls in PARAMETER_AGENTS]

    async def evaluate(
        self,
        *,
        sections: dict[str, str],
        proposal_id: Optional[str] = None,
        document_metadata=None,
    ) -> EvaluationResponse:
        """
        Score a proposal from its sections.

        `sections` is {section_key: text} — the output of the sectioniser, loaded either
        from the freshly-processed document or straight from the database. Loading from
        the database is what lets an admin evaluate a stored idea later with no re-upload
        and no re-extraction.
        """
        start = time.time()

        available = sorted(k for k, v in sections.items() if v and v.strip())
        logger.info(
            "evaluation_started",
            proposal_id=proposal_id,
            sections=available,
            agents=len(self.agents),
        )

        # --- 1. Parameter agents, in parallel -----------------------------
        semaphore = asyncio.Semaphore(settings.LLM_MAX_CONCURRENCY)

        async def run(agent) -> AgentResult:
            async with semaphore:
                return await agent.analyze(sections)

        # `analyze` already converts its own failures into a failed AgentResult, so a
        # raised exception here would be a bug in our code rather than an agent failure.
        # return_exceptions keeps one such bug from destroying the other six results.
        settled = await asyncio.gather(
            *(run(agent) for agent in self.agents), return_exceptions=True
        )

        results: dict[str, AgentResult] = {}
        for agent, outcome in zip(self.agents, settled):
            if isinstance(outcome, BaseException):
                logger.error(
                    "agent_crashed", agent=agent.name, error=str(outcome)
                )
                results[agent.parameter_key] = AgentResult(
                    agent_name=agent.name,
                    parameter_key=agent.parameter_key,
                    score=None,
                    status="failed",
                    error=str(outcome),
                    analysis=f"This parameter could not be evaluated: {outcome}",
                )
            else:
                results[agent.parameter_key] = outcome

        total_tokens = sum(r.tokens_used for r in results.values())

        # --- 2. Debate, only if the assessment contradicts itself ----------
        debate_result, debate_tokens = await debate_agent.analyze(results)
        total_tokens += debate_tokens

        if debate_result and debate_result.adjusted_scores:
            self._apply_debate_adjustments(results, debate_result)

        # --- 3. Blind synthesis --------------------------------------------
        evaluation, scoring_tokens = await scoring_agent.synthesize(
            agent_results=results, debate_result=debate_result
        )
        total_tokens += scoring_tokens

        elapsed = round(time.time() - start, 2)

        logger.info(
            "evaluation_completed",
            proposal_id=proposal_id,
            score=evaluation.overall_score,
            recommendation=evaluation.recommendation,
            coverage=evaluation.evidence_coverage,
            starved=[k for k, r in results.items() if r.starved],
            failed=[k for k, r in results.items() if r.status == "failed"],
            tokens=total_tokens,
            seconds=elapsed,
        )

        return EvaluationResponse(
            status="success",
            processing_status=ProcessingStatus.COMPLETED,
            evaluation=evaluation,
            agent_results={r.agent_name: r for r in results.values()},
            processing_time_seconds=elapsed,
            proposal_id=proposal_id,
            document_metadata=document_metadata,
            total_tokens=total_tokens,
            model_used=settings.LLM_MODEL,
        )

    def _apply_debate_adjustments(
        self, results: dict[str, AgentResult], debate: DebateResult
    ) -> None:
        """
        Apply the debate's score changes to the parameter results.

        The adjustment is recorded on the agent result itself so it flows into the final
        breakdown and the report — an evaluator reading the score can see that it was
        moved, by how much, and (via the debate summary) why. Silently rewriting a
        specialist's score with no trace would be worse than not adjusting at all.
        """
        for key, new_score in debate.adjusted_scores.items():
            result = results.get(key)
            if result is None or result.score is None:
                continue

            old = result.score
            if abs(old - new_score) < 0.5:
                continue

            result.score = new_score
            result.raw_output = {
                **result.raw_output,
                "debate_adjustment": {"from": old, "to": new_score},
            }
            logger.info(
                "debate_adjusted_score", parameter=key, before=old, after=new_score
            )


orchestrator = AgentOrchestrator()
