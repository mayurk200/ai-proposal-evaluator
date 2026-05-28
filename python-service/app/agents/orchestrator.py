"""
Agent Orchestrator — Coordinates the multi-agent evaluation pipeline.

Pipeline:
1. Extraction Agent (structured data from proposal)
2. Parallel Analysis Agents (Problem Relevance, Technical, Pilot Design, Team, Market, Financial, Strategic Impact)
3. Final Scoring Agent (synthesizes all analyses)

Agents run sequentially to respect rate limits.
"""

import json
import time
from typing import Any, Optional

from app.agents.extraction import ExtractionAgent
from app.agents.technical.technical_agent import TechnicalAgent
from app.agents.financial.financial_agent import FinancialAgent
from app.agents.problem_relevance_agent import ProblemRelevanceAgent
from app.agents.pilot_design_agent import PilotDesignAgent
from app.agents.team_agent import TeamAgent
from app.agents.market_agent import MarketAgent
from app.agents.strategic_impact_agent import StrategicImpactAgent
from app.agents.scoring.scoring_agent import ScoringAgent
from app.models.schemas import (
    AgentResult,
    DocumentChunk,
    DocumentMetadata,
    FinalEvaluation,
    SWOTAnalysis,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)


class AgentOrchestrator:
    """
    Coordinates the multi-agent evaluation pipeline.

    Runs agents sequentially to stay within Groq's TPM rate limit.
    Each agent receives relevant content and produces structured results.
    """

    def __init__(self):
        self.extraction_agent = ExtractionAgent()
        self.problem_relevance_agent = ProblemRelevanceAgent()
        self.technical_agent = TechnicalAgent()
        self.pilot_design_agent = PilotDesignAgent()
        self.team_agent = TeamAgent()
        self.market_agent = MarketAgent()
        self.financial_agent = FinancialAgent()
        self.strategic_impact_agent = StrategicImpactAgent()
        self.scoring_agent = ScoringAgent()

    async def evaluate(
        self,
        chunks: list[DocumentChunk],
        metadata: DocumentMetadata,
        summary: str = "",
    ) -> dict[str, Any]:
        """
        Run the full evaluation pipeline.

        Args:
            chunks: Processed document chunks with metadata.
            metadata: Document metadata.
            summary: Executive summary of the document.

        Returns:
            Dict with agent_results, final_evaluation, and timing info.
        """
        start_time = time.time()
        agent_results: dict[str, AgentResult] = {}
        metadata_dict = metadata.model_dump()

        # Build content for agents
        full_content = self._build_content(chunks, summary)

        # Build specialized content views for agents
        financial_content = self._build_content(
            [c for c in chunks if c.has_financial_data] or chunks,
            summary,
        )
        technical_content = self._build_content(
            [c for c in chunks if c.has_technical_content] or chunks,
            summary,
        )

        # =====================================================================
        # Step 1: Extraction
        # =====================================================================
        logger.info("running_agent", agent="ExtractionAgent")
        extraction_result = await self.extraction_agent.analyze(full_content, metadata_dict)
        agent_results["extraction"] = extraction_result

        # Use extraction data as context for subsequent agents
        extracted_data = json.dumps(extraction_result.raw_output, indent=2)
        enriched_content = f"EXTRACTED PROPOSAL DATA:\n{extracted_data}\n\nFULL PROPOSAL TEXT:\n{full_content}"
        enriched_financial = f"EXTRACTED PROPOSAL DATA:\n{extracted_data}\n\nFINANCIAL CONTENT:\n{financial_content}"
        enriched_technical = f"EXTRACTED PROPOSAL DATA:\n{extracted_data}\n\nTECHNICAL CONTENT:\n{technical_content}"

        # =====================================================================
        # Step 2: Analysis Agents (sequential for rate limit safety)
        # =====================================================================
        analysis_agents = [
            ("problem_relevance", self.problem_relevance_agent, enriched_content),
            ("technical", self.technical_agent, enriched_technical),
            ("pilot_design", self.pilot_design_agent, enriched_content),
            ("team", self.team_agent, enriched_content),
            ("market", self.market_agent, enriched_content),
            ("financial", self.financial_agent, enriched_financial),
            ("strategic_impact", self.strategic_impact_agent, enriched_content),
        ]

        for agent_key, agent, content in analysis_agents:
            logger.info("running_agent", agent=agent.name)
            result = await agent.analyze(content, metadata_dict)
            agent_results[agent_key] = result

            # Small delay between agents to avoid rate limiting
            import asyncio
            await asyncio.sleep(1)

        # =====================================================================
        # Step 3: Final Scoring
        # =====================================================================
        logger.info("running_agent", agent="FinalScoringAgent")

        # Build comprehensive input for final scoring
        all_analyses = {}
        for key, result in agent_results.items():
            all_analyses[key] = {
                "score": result.score,
                "analysis": result.analysis,
                "key_findings": result.key_findings,
                "red_flags": result.red_flags,
                "recommendations": result.recommendations,
                "raw_scores": {
                    k: v for k, v in result.raw_output.items()
                    if isinstance(v, (int, float)) and k != "confidence"
                },
            }

        scoring_input = json.dumps(all_analyses, indent=2)
        scoring_result = await self.scoring_agent.analyze(
            f"ALL AGENT ANALYSES:\n{scoring_input}", metadata_dict
        )
        agent_results["scoring"] = scoring_result

        # =====================================================================
        # Build final evaluation
        # =====================================================================
        final_eval = self._build_final_evaluation(scoring_result, agent_results)

        total_time = time.time() - start_time
        total_tokens = sum(r.tokens_used for r in agent_results.values())

        logger.info(
            "evaluation_complete",
            overall_score=final_eval.overall_score,
            recommendation=final_eval.recommendation,
            total_tokens=total_tokens,
            total_time_seconds=round(total_time, 2),
        )

        return {
            "agent_results": {k: v.model_dump() for k, v in agent_results.items()},
            "final_evaluation": final_eval.model_dump(),
            "total_tokens": total_tokens,
            "total_time_seconds": round(total_time, 2),
        }

    def _build_content(self, chunks: list[DocumentChunk], summary: str = "") -> str:
        """Build combined text content from chunks and summary."""
        parts = []

        if summary:
            parts.append(f"EXECUTIVE SUMMARY:\n{summary}")

        for chunk in chunks:
            header = f"\n--- Section: {chunk.section_title} (Pages: {', '.join(str(p) for p in chunk.page_numbers)}) ---"
            parts.append(f"{header}\n{chunk.text}")

        return "\n\n".join(parts)

    def _build_final_evaluation(
        self,
        scoring_result: AgentResult,
        agent_results: dict[str, AgentResult],
    ) -> FinalEvaluation:
        """Build the FinalEvaluation from the scoring agent's output."""
        raw = scoring_result.raw_output

        # Extract SWOT
        swot_data = raw.get("swot_analysis", {})
        swot = SWOTAnalysis(
            strengths=swot_data.get("strengths", []),
            weaknesses=swot_data.get("weaknesses", []),
            opportunities=swot_data.get("opportunities", []),
            threats=swot_data.get("threats", []),
        )

        pr = raw.get("problem_relevance_score", agent_results.get("problem_relevance", AgentResult(agent_name="")).score)
        ts = raw.get("technical_soundness_score", agent_results.get("technical", AgentResult(agent_name="")).score)
        pd = raw.get("pilot_design_score", agent_results.get("pilot_design", AgentResult(agent_name="")).score)
        tc = raw.get("team_capability_score", agent_results.get("team", AgentResult(agent_name="")).score)
        mp = raw.get("market_potential_score", agent_results.get("market", AgentResult(agent_name="")).score)
        fs = raw.get("financial_sustainability_score", agent_results.get("financial", AgentResult(agent_name="")).score)
        si = raw.get("strategic_impact_score", agent_results.get("strategic_impact", AgentResult(agent_name="")).score)

        calculated_overall = (
            pr * 0.20 +
            ts * 0.20 +
            pd * 0.15 +
            tc * 0.15 +
            mp * 0.10 +
            fs * 0.10 +
            si * 0.10
        )

        # Force strict recommendation
        recommendation = raw.get("recommendation", "Reject")
        if recommendation not in ["Select", "Reject"]:
            recommendation = "Reject"

        # Use scoring agent's raw scores or fallback to individual agent scores
        return FinalEvaluation(
            overall_score=round(calculated_overall, 2),
            problem_relevance_score=pr,
            technical_soundness_score=ts,
            pilot_design_score=pd,
            team_capability_score=tc,
            market_potential_score=mp,
            financial_sustainability_score=fs,
            strategic_impact_score=si,
            recommendation=recommendation,
            summary=raw.get("summary", scoring_result.analysis),
            strengths=raw.get("strengths", []),
            weaknesses=raw.get("weaknesses", []),
            swot_analysis=swot,
            key_points=raw.get("key_points", []),
            invalid_claims=raw.get("invalid_claims", []),
            investment_readiness=raw.get("investment_readiness", ""),
            key_action_items=raw.get("key_action_items", []),
            risk_level=raw.get("risk_level", "Medium"),
        )
