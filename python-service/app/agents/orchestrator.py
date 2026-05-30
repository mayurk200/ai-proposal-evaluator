"""
Agent Orchestrator — Coordinates the multi-agent evaluation pipeline.

Pipeline:
1. Extraction Agent (structured data from proposal)
2. Analysis Agents (Problem Relevance, Technical, Pilot Design, Team, Market, Financial, Strategic Impact)
3. Deterministic Scoring Engine (pure Python — no LLM call)

Agents run sequentially to respect rate limits.
Final scoring is deterministic — weighted average computed in Python, not by LLM.
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
from app.agents.validation import clamp_score
from app.config import settings
from app.models.schemas import (
    AgentResult,
    DocumentChunk,
    DocumentMetadata,
    EvidenceItem,
    FinalEvaluation,
    SWOTAnalysis,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Scoring weights (preserved from original)
# ---------------------------------------------------------------------------
SCORING_WEIGHTS = {
    "problem_relevance": 0.20,
    "technical": 0.20,
    "pilot_design": 0.15,
    "team": 0.15,
    "market": 0.10,
    "financial": 0.10,
    "strategic_impact": 0.10,
}

# Maps from agent key to FinalEvaluation field name
SCORE_FIELD_MAP = {
    "problem_relevance": "problem_relevance_score",
    "technical": "technical_soundness_score",
    "pilot_design": "pilot_design_score",
    "team": "team_capability_score",
    "market": "market_potential_score",
    "financial": "financial_sustainability_score",
    "strategic_impact": "strategic_impact_score",
}

# Extraction fields relevant to each agent (for targeted context)
AGENT_CONTEXT_FIELDS = {
    "problem_relevance": [
        "problem_statement", "proposed_solution", "geographic_focus",
        "sustainability_approach", "target_market",
    ],
    "technical": [
        "technology_used", "proposed_solution", "competitive_advantages",
        "current_traction",
    ],
    "pilot_design": [
        "timeline", "key_metrics", "funding_requirements",
        "geographic_focus", "team_size",
    ],
    "team": [
        "founders", "team_size", "partnerships",
    ],
    "market": [
        "target_market", "revenue_streams", "business_model",
        "competitive_advantages",
    ],
    "financial": [
        "funding_requirements", "revenue_streams", "business_model",
        "current_traction",
    ],
    "strategic_impact": [
        "sustainability_approach", "geographic_focus", "target_market",
        "problem_statement",
    ],
}


class AgentOrchestrator:
    """
    Coordinates the multi-agent evaluation pipeline.

    Runs agents sequentially to stay within Groq's TPM rate limit.
    Each agent receives relevant content and produces structured results.
    Final scoring is DETERMINISTIC — computed in Python, not by LLM.
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

        # Parse extraction data for targeted context
        extracted_data = extraction_result.raw_output
        if extracted_data.get("_parse_error"):
            extracted_data = {}

        # =====================================================================
        # Step 2: Analysis Agents (sequential for rate limit safety)
        # =====================================================================
        analysis_agents = [
            ("problem_relevance", self.problem_relevance_agent, full_content),
            ("technical", self.technical_agent, technical_content),
            ("pilot_design", self.pilot_design_agent, full_content),
            ("team", self.team_agent, full_content),
            ("market", self.market_agent, full_content),
            ("financial", self.financial_agent, financial_content),
            ("strategic_impact", self.strategic_impact_agent, full_content),
        ]

        for agent_key, agent, base_content in analysis_agents:
            logger.info("running_agent", agent=agent.name)

            # Build targeted context — only relevant extracted fields per agent
            enriched_content = self._build_agent_context(
                agent_key, extracted_data, base_content
            )

            result = await agent.analyze(enriched_content, metadata_dict)
            agent_results[agent_key] = result

            # Small delay between agents to avoid rate limiting
            import asyncio
            await asyncio.sleep(1)

        # =====================================================================
        # Step 3: Deterministic Scoring (NO LLM call)
        # =====================================================================
        logger.info("computing_deterministic_scores")
        final_eval = self._compute_deterministic_evaluation(agent_results, metadata)

        # Create a synthetic "scoring" AgentResult for backward compatibility
        scoring_result = self._build_synthetic_scoring_result(
            agent_results, final_eval, start_time
        )
        agent_results["scoring"] = scoring_result

        total_time = time.time() - start_time
        total_tokens = sum(r.tokens_used for r in agent_results.values())

        logger.info(
            "evaluation_complete",
            overall_score=final_eval.overall_score,
            recommendation=final_eval.recommendation,
            total_tokens=total_tokens,
            total_time_seconds=round(total_time, 2),
            failed_agents=[k for k, v in agent_results.items() if v.status != "success"],
        )

        return {
            "agent_results": {k: v.model_dump() for k, v in agent_results.items()},
            "final_evaluation": final_eval.model_dump(),
            "total_tokens": total_tokens,
            "total_time_seconds": round(total_time, 2),
        }

    # =========================================================================
    # Content Building
    # =========================================================================

    def _build_content(self, chunks: list[DocumentChunk], summary: str = "") -> str:
        """Build combined text content from chunks and summary."""
        parts = []

        if summary:
            parts.append(f"EXECUTIVE SUMMARY:\n{summary}")

        for chunk in chunks:
            header = f"\n--- Section: {chunk.section_title} (Pages: {', '.join(str(p) for p in chunk.page_numbers)}) ---"
            parts.append(f"{header}\n{chunk.text}")

        return "\n\n".join(parts)

    def _build_agent_context(
        self,
        agent_key: str,
        extracted_data: dict[str, Any],
        base_content: str,
    ) -> str:
        """
        Build targeted context for a specific agent.
        Only includes relevant extracted fields to reduce token usage.
        """
        if not extracted_data:
            return base_content

        relevant_fields = AGENT_CONTEXT_FIELDS.get(agent_key, [])
        if not relevant_fields:
            return base_content

        context_parts: list[str] = []
        for field in relevant_fields:
            value = extracted_data.get(field)
            if value and value != "Not specified" and value != []:
                if isinstance(value, list):
                    context_parts.append(f"{field}: {json.dumps(value)}")
                else:
                    context_parts.append(f"{field}: {value}")

        if not context_parts:
            return base_content

        context_header = "RELEVANT EXTRACTED DATA:\n" + "\n".join(context_parts)
        return f"{context_header}\n\nPROPOSAL TEXT:\n{base_content}"

    # =========================================================================
    # Deterministic Scoring Engine
    # =========================================================================

    def _compute_deterministic_evaluation(
        self,
        agent_results: dict[str, AgentResult],
        metadata: DocumentMetadata,
    ) -> FinalEvaluation:
        """
        Compute the final evaluation using pure Python.
        No LLM involved — fully deterministic and auditable.
        """
        # 1. Collect and clamp individual scores
        scores: dict[str, float] = {}
        for agent_key in SCORING_WEIGHTS:
            result = agent_results.get(agent_key)
            if result and result.status == "success":
                scores[agent_key] = clamp_score(result.score)
            else:
                scores[agent_key] = 0.0

        # 2. Compute weighted overall score
        overall_score = sum(
            scores[k] * SCORING_WEIGHTS[k] for k in SCORING_WEIGHTS
        )
        overall_score = round(clamp_score(overall_score), 2)

        # 3. Determine recommendation (deterministic rules)
        recommendation = self._compute_recommendation(scores, overall_score, agent_results)

        # 4. Aggregate SWOT from all agents
        swot = self._aggregate_swot(agent_results)

        # 5. Aggregate strengths, weaknesses, red flags
        all_strengths = self._aggregate_field(agent_results, "key_findings")
        all_weaknesses = self._aggregate_field(agent_results, "red_flags")
        all_key_points = self._aggregate_field(agent_results, "recommendations")

        # 6. Collect invalid claims from extraction
        invalid_claims: list[str] = []
        extraction = agent_results.get("extraction")
        if extraction:
            invalid_claims = extraction.raw_output.get("unclear_claims", [])

        # 7. Compute risk level
        risk_level = self._compute_risk_level(scores, agent_results)

        # 8. Compute investment readiness
        investment_readiness = self._compute_investment_readiness(overall_score, scores)

        # 9. Compute confidence with degradation
        confidence = self._compute_confidence(agent_results, metadata)

        # 10. Generate summary
        summary = self._generate_summary(scores, overall_score, recommendation, agent_results)

        # 11. Action items
        key_action_items = self._generate_action_items(agent_results, scores)

        return FinalEvaluation(
            overall_score=overall_score,
            problem_relevance_score=scores.get("problem_relevance", 0),
            technical_soundness_score=scores.get("technical", 0),
            pilot_design_score=scores.get("pilot_design", 0),
            team_capability_score=scores.get("team", 0),
            market_potential_score=scores.get("market", 0),
            financial_sustainability_score=scores.get("financial", 0),
            strategic_impact_score=scores.get("strategic_impact", 0),
            recommendation=recommendation,
            summary=summary,
            strengths=all_strengths[:10],
            weaknesses=all_weaknesses[:10],
            swot_analysis=swot,
            key_points=all_key_points[:10],
            invalid_claims=invalid_claims[:10],
            investment_readiness=investment_readiness,
            key_action_items=key_action_items[:10],
            risk_level=risk_level,
        )

    def _compute_recommendation(
        self,
        scores: dict[str, float],
        overall_score: float,
        agent_results: dict[str, AgentResult],
    ) -> str:
        """
        Deterministic recommendation: Select or Reject.

        Select requires:
        - Overall score >= SELECT_THRESHOLD (default 75)
        - No individual agent score below MIN_AGENT_SCORE_THRESHOLD (default 40)
        - No critical red flags across agents
        """
        # Check overall threshold
        if overall_score < settings.SELECT_THRESHOLD:
            return "Reject"

        # Check per-agent minimum
        for agent_key, score in scores.items():
            if score < settings.MIN_AGENT_SCORE_THRESHOLD:
                return "Reject"

        # Check for critical red flags
        total_red_flags = sum(
            len(r.red_flags) for r in agent_results.values()
            if r.status == "success"
        )
        if total_red_flags >= 5:
            return "Reject"

        # Check for failed agents
        failed_count = sum(
            1 for r in agent_results.values()
            if r.status in ("failed", "timeout")
        )
        if failed_count >= 2:
            return "Reject"

        return "Select"

    def _aggregate_swot(self, agent_results: dict[str, AgentResult]) -> SWOTAnalysis:
        """Aggregate SWOT from all agent results deterministically."""
        strengths: list[str] = []
        weaknesses: list[str] = []
        opportunities: list[str] = []
        threats: list[str] = []

        for key, result in agent_results.items():
            if result.status != "success" or key == "extraction":
                continue

            # Strengths from key_findings
            for finding in result.key_findings[:3]:
                if finding and finding not in strengths:
                    strengths.append(finding)

            # Weaknesses from red_flags
            for flag in result.red_flags[:3]:
                if flag and flag not in weaknesses:
                    weaknesses.append(flag)

            # Opportunities from recommendations
            for rec in result.recommendations[:2]:
                if rec and rec not in opportunities:
                    opportunities.append(rec)

            # Threats from raw_output risk_factors
            for risk in result.raw_output.get("risk_factors", [])[:2]:
                if isinstance(risk, str) and risk and risk not in threats:
                    threats.append(risk)

        return SWOTAnalysis(
            strengths=strengths[:8],
            weaknesses=weaknesses[:8],
            opportunities=opportunities[:6],
            threats=threats[:6],
        )

    def _aggregate_field(
        self, agent_results: dict[str, AgentResult], field_name: str
    ) -> list[str]:
        """Aggregate a list field from all successful agents, deduplicated."""
        items: list[str] = []
        for key, result in agent_results.items():
            if result.status != "success":
                continue
            values = getattr(result, field_name, [])
            for v in values:
                if v and v not in items:
                    items.append(v)
        return items

    def _compute_risk_level(
        self, scores: dict[str, float], agent_results: dict[str, AgentResult]
    ) -> str:
        """Deterministic risk level from scores and red flags."""
        min_score = min(scores.values()) if scores else 0
        total_red_flags = sum(
            len(r.red_flags) for r in agent_results.values() if r.status == "success"
        )
        failed_agents = sum(1 for r in agent_results.values() if r.status != "success")

        if min_score < 20 or total_red_flags >= 8 or failed_agents >= 3:
            return "Critical"
        if min_score < 40 or total_red_flags >= 5 or failed_agents >= 2:
            return "High"
        if min_score < 60 or total_red_flags >= 3:
            return "Medium"
        return "Low"

    def _compute_investment_readiness(
        self, overall_score: float, scores: dict[str, float]
    ) -> str:
        """Deterministic investment readiness from score bands."""
        min_score = min(scores.values()) if scores else 0

        if overall_score >= 75 and min_score >= 50:
            return "Ready"
        if overall_score >= 50 and min_score >= 30:
            return "Needs Work"
        return "Not Ready"

    def _compute_confidence(
        self, agent_results: dict[str, AgentResult], metadata: DocumentMetadata
    ) -> float:
        """
        Compute overall confidence with degradation factors.

        Starts at 1.0 and degrades based on:
        - OCR quality
        - Document length
        - Failed agents
        - Missing information
        """
        confidence = 1.0

        # Degrade for poor OCR
        if metadata.ocr_confidence < 0.5:
            confidence *= 0.7

        # Degrade for short documents
        if metadata.total_words < 500:
            confidence *= 0.6
        elif metadata.total_words < 1000:
            confidence *= 0.8

        # Degrade for failed agents
        for result in agent_results.values():
            if result.status in ("failed", "timeout"):
                confidence *= 0.8

        # Degrade for lots of missing information
        total_missing = sum(
            len(r.missing_information) for r in agent_results.values()
        )
        if total_missing >= 10:
            confidence *= 0.7
        elif total_missing >= 5:
            confidence *= 0.85

        return round(max(0.0, min(1.0, confidence)), 2)

    def _generate_summary(
        self,
        scores: dict[str, float],
        overall_score: float,
        recommendation: str,
        agent_results: dict[str, AgentResult],
    ) -> str:
        """Generate a deterministic executive summary from scores and analyses."""
        parts: list[str] = []

        parts.append(
            f"Overall evaluation score: {overall_score}/100. "
            f"Recommendation: {recommendation}."
        )

        # Top 3 strengths
        strongest = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:3]
        if strongest:
            strong_names = [f"{k.replace('_', ' ').title()} ({v:.0f})" for k, v in strongest]
            parts.append(f"Strongest areas: {', '.join(strong_names)}.")

        # Bottom 3 weaknesses
        weakest = sorted(scores.items(), key=lambda x: x[1])[:3]
        if weakest:
            weak_names = [f"{k.replace('_', ' ').title()} ({v:.0f})" for k, v in weakest]
            parts.append(f"Weakest areas: {', '.join(weak_names)}.")

        # Key red flags
        all_flags = []
        for r in agent_results.values():
            if r.status == "success":
                all_flags.extend(r.red_flags[:2])
        if all_flags:
            parts.append(f"Key concerns: {'; '.join(all_flags[:5])}.")

        # Failed agents warning
        failed = [k for k, v in agent_results.items() if v.status != "success"]
        if failed:
            parts.append(
                f"WARNING: {len(failed)} agent(s) failed ({', '.join(failed)}). "
                "Evaluation confidence is reduced."
            )

        return " ".join(parts)

    def _generate_action_items(
        self, agent_results: dict[str, AgentResult], scores: dict[str, float]
    ) -> list[str]:
        """Generate action items based on weak areas and recommendations."""
        items: list[str] = []

        # Action items for weakest scores
        weakest = sorted(scores.items(), key=lambda x: x[1])
        for agent_key, score in weakest:
            if score < 60:
                result = agent_results.get(agent_key)
                if result and result.recommendations:
                    items.append(
                        f"[{agent_key.replace('_', ' ').title()}] {result.recommendations[0]}"
                    )

        # Add top recommendations from all agents
        for key, result in agent_results.items():
            if result.status == "success":
                for rec in result.recommendations[:1]:
                    item = f"[{key.replace('_', ' ').title()}] {rec}"
                    if item not in items:
                        items.append(item)

        return items

    def _build_synthetic_scoring_result(
        self,
        agent_results: dict[str, AgentResult],
        final_eval: FinalEvaluation,
        start_time: float,
    ) -> AgentResult:
        """
        Build a synthetic AgentResult for the 'scoring' key.
        Provides backward compatibility — the response shape is identical
        to the old LLM-based scoring agent.
        """
        return AgentResult(
            agent_name="DeterministicScoringEngine",
            score=final_eval.overall_score,
            confidence=self._compute_confidence(
                agent_results,
                DocumentMetadata(filename="", format=""),
            ),
            analysis=final_eval.summary,
            key_findings=final_eval.strengths[:5],
            red_flags=final_eval.weaknesses[:5],
            recommendations=final_eval.key_action_items[:5],
            raw_output={
                "overall_score": final_eval.overall_score,
                "problem_relevance_score": final_eval.problem_relevance_score,
                "technical_soundness_score": final_eval.technical_soundness_score,
                "pilot_design_score": final_eval.pilot_design_score,
                "team_capability_score": final_eval.team_capability_score,
                "market_potential_score": final_eval.market_potential_score,
                "financial_sustainability_score": final_eval.financial_sustainability_score,
                "strategic_impact_score": final_eval.strategic_impact_score,
                "recommendation": final_eval.recommendation,
                "summary": final_eval.summary,
                "strengths": final_eval.strengths,
                "weaknesses": final_eval.weaknesses,
                "swot_analysis": final_eval.swot_analysis.model_dump(),
                "key_points": final_eval.key_points,
                "invalid_claims": final_eval.invalid_claims,
                "investment_readiness": final_eval.investment_readiness,
                "key_action_items": final_eval.key_action_items,
                "risk_level": final_eval.risk_level,
                "confidence": 1.0,
            },
            tokens_used=0,
            duration_ms=int((time.time() - start_time) * 1000),
            status="success",
        )
