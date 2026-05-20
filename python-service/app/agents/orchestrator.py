"""
Agent Orchestrator — Coordinates the multi-agent evaluation pipeline.

Pipeline:
1. Extraction Agent (structured data from proposal)
2. Parallel Analysis Agents (technical, financial, risk, innovation, feasibility, compliance, sustainability)
3. Final Scoring Agent (synthesizes all analyses)

Agents run sequentially to respect Groq rate limits.
"""

import json
import time
from typing import Any, Optional

from app.agents.extraction_agent import ExtractionAgent
from app.agents.technical_agent import TechnicalAgent
from app.agents.financial_agent import FinancialAgent
from app.agents.risk_agent import RiskAgent
from app.agents.innovation_agent import InnovationAgent
from app.agents.feasibility_agent import FeasibilityAgent
from app.agents.compliance_agent import ComplianceAgent
from app.agents.sustainability_agent import SustainabilityAgent
from app.agents.scoring_agent import ScoringAgent
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
        self.technical_agent = TechnicalAgent()
        self.financial_agent = FinancialAgent()
        self.risk_agent = RiskAgent()
        self.innovation_agent = InnovationAgent()
        self.feasibility_agent = FeasibilityAgent()
        self.compliance_agent = ComplianceAgent()
        self.sustainability_agent = SustainabilityAgent()
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
            ("technical", self.technical_agent, enriched_technical),
            ("financial", self.financial_agent, enriched_financial),
            ("risk", self.risk_agent, enriched_content),
            ("innovation", self.innovation_agent, enriched_content),
            ("feasibility", self.feasibility_agent, enriched_content),
            ("compliance", self.compliance_agent, enriched_content),
            ("sustainability", self.sustainability_agent, enriched_content),
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

        return FinalEvaluation(
            overall_score=raw.get("overall_score", scoring_result.score),
            innovation_score=raw.get("innovation_score", agent_results.get("innovation", AgentResult(agent_name="")).score),
            market_score=raw.get("market_score", 0),
            agriculture_score=raw.get("agriculture_score", 0),
            financial_score=raw.get("financial_score", agent_results.get("financial", AgentResult(agent_name="")).score),
            scalability_score=raw.get("scalability_score", 0),
            sustainability_score=raw.get("sustainability_score", agent_results.get("sustainability", AgentResult(agent_name="")).score),
            risk_score=raw.get("risk_score", agent_results.get("risk", AgentResult(agent_name="")).score),
            technical_score=raw.get("technical_score", agent_results.get("technical", AgentResult(agent_name="")).score),
            feasibility_score=raw.get("feasibility_score", agent_results.get("feasibility", AgentResult(agent_name="")).score),
            compliance_score=raw.get("compliance_score", agent_results.get("compliance", AgentResult(agent_name="")).score),
            recommendation=raw.get("recommendation", "Not Recommended"),
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
