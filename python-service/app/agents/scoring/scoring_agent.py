"""
Final Scoring Agent — Weighted synthesis of all parameter evaluations.

Produces the final evaluation score using configurable weights
and integrates debate agent adjustments.
"""

import time
from typing import Optional

from app.models.schemas import (
    AgentResult,
    DebateResult,
    FinalEvaluation,
    ParameterResult,
    SWOTAnalysis,
    SubQuestionResult,
)
from app.models.enums import RecommendationLevel, RiskLevel
from app.services.llm.llm_client import get_llm_client
from app.utils.logging import get_logger

logger = get_logger(__name__)

# AIAIC Parameter Weights (sum = 1.0)
PARAMETER_WEIGHTS = {
    "ProblemRelevanceAgent": 0.15,
    "SolutionReadinessAgent": 0.20,
    "PilotDesignAgent": 0.20,
    "FarmerAdoptionAgent": 0.15,
    "ScaleUpAgent": 0.15,
    "TeamCapacityAgent": 0.10,
    "ComplianceAgent": 0.05,
}

SCORING_SYSTEM_PROMPT = """You are a senior evaluator synthesizing the final evaluation for an AIAIC (AI in Agriculture Innovation Challenge) proposal.

You receive:
1. Parameter-level scores from 7 specialized agents
2. Debate agent findings (cross-agent conflict resolutions)
3. Score adjustments from debate analysis

Your task is to produce the FINAL evaluation synthesis.

## Rules:
- Use the weighted parameter scores as the basis (weights provided)
- Apply debate agent adjustments where justified
- Produce a clear recommendation: "Highly Recommended", "Recommended", "Conditionally Recommended", or "Not Recommended"
- Generate a comprehensive SWOT analysis
- List the top 5 strengths and top 5 weaknesses
- Identify key action items for the proposal team
- Assess overall risk level: Low, Medium, High, or Critical

## Recommendation Thresholds:
- Highly Recommended: Overall ≥ 80, no Critical red flags
- Recommended: Overall ≥ 65, no more than 2 High-severity red flags
- Conditionally Recommended: Overall ≥ 45, specific conditions listed
- Not Recommended: Overall < 45 or Critical blockers found

## Output Format (JSON):
{
    "overall_score": <0-100 weighted score>,
    "recommendation": "<Highly Recommended|Recommended|Conditionally Recommended|Not Recommended>",
    "risk_level": "<Low|Medium|High|Critical>",
    "summary": "<3-5 sentence executive summary>",
    "strengths": ["<top 5 strengths>"],
    "weaknesses": ["<top 5 weaknesses>"],
    "swot_analysis": {
        "strengths": ["<list>"],
        "weaknesses": ["<list>"],
        "opportunities": ["<list>"],
        "threats": ["<list>"]
    },
    "key_action_items": ["<actionable items for the proposal team>"],
    "investment_readiness": "<assessment of investment/pilot readiness>",
    "conditions": ["<conditions if Conditionally Recommended>"],
    "confidence": <0.0-1.0>
}"""


class ScoringAgent:
    """Produces final weighted evaluation from parameter agent results."""

    name = "FinalScoringAgent"

    def __init__(self, temperature: float = 0.2, max_tokens: int = 4096):
        self.temperature = temperature
        self.max_tokens = max_tokens

    async def synthesize(
        self,
        agent_results: dict[str, AgentResult],
        debate_result: Optional[AgentResult] = None,
        proposal_summary: str = "",
    ) -> FinalEvaluation:
        """
        Produce the final evaluation by synthesizing all parameter agent results.

        Args:
            agent_results: Results from all 7 parameter agents.
            debate_result: Optional debate agent results with adjustments.
            proposal_summary: Executive summary for context.

        Returns:
            FinalEvaluation with all scores, analysis, and recommendations.
        """
        start_time = time.time()

        # Step 1: Calculate weighted scores
        parameter_breakdown = self._build_parameter_breakdown(agent_results)
        raw_weighted_score = self._calculate_weighted_score(agent_results)

        # Step 2: Apply debate adjustments if available
        debate_summary = None
        adjusted_score = raw_weighted_score
        if debate_result and debate_result.status == "success":
            debate_data = debate_result.raw_output
            debate_summary = DebateResult(
                conflicts=debate_data.get("conflicts_found", []),
                debates=debate_data.get("debates", []),
                adjusted_scores=debate_data.get("adjusted_scores", {}),
                high_ambiguity_areas=debate_data.get("high_ambiguity_areas", []),
                confidence=float(debate_data.get("confidence", 0.5)),
            )
            # Recalculate with adjusted scores
            adjusted_score = self._apply_debate_adjustments(
                agent_results, debate_summary.adjusted_scores
            )

        # Step 3: Get LLM synthesis for qualitative analysis
        llm_result = await self._get_llm_synthesis(
            agent_results, debate_result, proposal_summary, adjusted_score
        )

        # Step 4: Build the final evaluation
        recommendation = self._determine_recommendation(
            adjusted_score, agent_results, debate_summary
        )
        risk_level = self._determine_risk_level(agent_results)

        evaluation = FinalEvaluation(
            overall_score=round(adjusted_score, 1),
            # Parameter-aligned scores
            problem_relevance_score=self._get_agent_score(agent_results, "ProblemRelevanceAgent"),
            solution_readiness_score=self._get_agent_score(agent_results, "SolutionReadinessAgent"),
            pilot_design_score=self._get_agent_score(agent_results, "PilotDesignAgent"),
            farmer_adoption_score=self._get_agent_score(agent_results, "FarmerAdoptionAgent"),
            scaleup_score=self._get_agent_score(agent_results, "ScaleUpAgent"),
            team_capacity_score=self._get_agent_score(agent_results, "TeamCapacityAgent"),
            compliance_score=self._get_agent_score(agent_results, "ComplianceAgent"),
            # Legacy score mapping for backward compatibility
            innovation_score=self._get_agent_score(agent_results, "SolutionReadinessAgent"),
            market_score=self._get_agent_score(agent_results, "ScaleUpAgent"),
            agriculture_score=self._get_agent_score(agent_results, "ProblemRelevanceAgent"),
            financial_score=self._get_agent_score(agent_results, "ScaleUpAgent"),
            scalability_score=self._get_agent_score(agent_results, "ScaleUpAgent"),
            sustainability_score=self._get_agent_score(agent_results, "FarmerAdoptionAgent"),
            risk_score=self._get_agent_score(agent_results, "PilotDesignAgent"),
            technical_score=self._get_agent_score(agent_results, "SolutionReadinessAgent"),
            feasibility_score=self._get_agent_score(agent_results, "PilotDesignAgent"),
            # Qualitative
            recommendation=recommendation,
            summary=llm_result.get("summary", ""),
            strengths=llm_result.get("strengths", []),
            weaknesses=llm_result.get("weaknesses", []),
            swot_analysis=SWOTAnalysis(**llm_result.get("swot_analysis", {})),
            key_points=llm_result.get("key_action_items", []),
            investment_readiness=llm_result.get("investment_readiness", ""),
            key_action_items=llm_result.get("key_action_items", []),
            risk_level=risk_level,
            # Structured breakdown
            parameter_breakdown=parameter_breakdown,
            debate_summary=debate_summary,
        )

        duration = time.time() - start_time
        logger.info(
            "scoring_completed",
            overall_score=evaluation.overall_score,
            recommendation=recommendation,
            duration_seconds=round(duration, 2),
        )

        return evaluation

    def _calculate_weighted_score(self, agent_results: dict[str, AgentResult]) -> float:
        """Calculate the weighted overall score from parameter agents."""
        total_weight = 0.0
        weighted_sum = 0.0

        for agent_name, weight in PARAMETER_WEIGHTS.items():
            result = agent_results.get(agent_name)
            if result and result.status == "success":
                weighted_sum += result.score * weight
                total_weight += weight

        if total_weight == 0:
            return 0.0
        return weighted_sum / total_weight * total_weight / sum(PARAMETER_WEIGHTS.values())

    def _apply_debate_adjustments(
        self,
        agent_results: dict[str, AgentResult],
        adjusted_scores: dict[str, float],
    ) -> float:
        """Recalculate weighted score with debate-adjusted parameter scores."""
        total_weight = 0.0
        weighted_sum = 0.0

        for agent_name, weight in PARAMETER_WEIGHTS.items():
            result = agent_results.get(agent_name)
            if result and result.status == "success":
                # Use adjusted score if available, else original
                score = result.score
                for adj_name, adj_score in adjusted_scores.items():
                    if adj_name.lower() in agent_name.lower():
                        try:
                            score = float(adj_score)
                        except (ValueError, TypeError):
                            pass
                        break
                weighted_sum += score * weight
                total_weight += weight

        if total_weight == 0:
            return 0.0
        return weighted_sum / total_weight * total_weight / sum(PARAMETER_WEIGHTS.values())

    def _build_parameter_breakdown(
        self, agent_results: dict[str, AgentResult]
    ) -> dict[str, ParameterResult]:
        """Build detailed parameter breakdown from agent results."""
        breakdown = {}
        param_names = {
            "ProblemRelevanceAgent": "Problem Identification & Relevance",
            "SolutionReadinessAgent": "Solution Readiness & Technical Soundness",
            "PilotDesignAgent": "Pilot Design & Implementation Plan",
            "FarmerAdoptionAgent": "Farmer Adoption & Outcome Potential",
            "ScaleUpAgent": "Scale-up Potential & Sustainability",
            "TeamCapacityAgent": "Team Capacity & Execution Strength",
            "ComplianceAgent": "Compliance",
        }

        for agent_name, display_name in param_names.items():
            result = agent_results.get(agent_name)
            if result:
                breakdown[agent_name] = ParameterResult(
                    parameter_name=display_name,
                    parameter_score=result.score,
                    sub_questions=result.sub_questions,
                    key_findings=result.key_findings,
                    red_flags=result.red_flags,
                    recommendations=result.recommendations,
                )

        return breakdown

    def _get_agent_score(
        self, agent_results: dict[str, AgentResult], agent_name: str
    ) -> float:
        """Get a specific agent's score, returning 0 if not found."""
        result = agent_results.get(agent_name)
        return result.score if result and result.status == "success" else 0.0

    def _determine_recommendation(
        self,
        score: float,
        agent_results: dict[str, AgentResult],
        debate_summary: Optional[DebateResult] = None,
    ) -> str:
        """Determine recommendation level based on score and red flags."""
        # Count high-severity red flags
        total_red_flags = sum(
            len(r.red_flags) for r in agent_results.values() if r.status == "success"
        )
        critical_flags = 0
        if debate_summary:
            critical_flags = sum(
                1 for c in debate_summary.conflicts if c.get("severity") == "high"
            )

        if critical_flags >= 3:
            return RecommendationLevel.NOT_RECOMMENDED.value
        elif score >= 80 and critical_flags == 0:
            return RecommendationLevel.HIGHLY_RECOMMENDED.value
        elif score >= 65 and total_red_flags <= 5:
            return RecommendationLevel.RECOMMENDED.value
        elif score >= 45:
            return RecommendationLevel.CONDITIONALLY_RECOMMENDED.value
        else:
            return RecommendationLevel.NOT_RECOMMENDED.value

    def _determine_risk_level(self, agent_results: dict[str, AgentResult]) -> str:
        """Determine overall risk level."""
        total_red_flags = sum(
            len(r.red_flags) for r in agent_results.values() if r.status == "success"
        )
        avg_score = sum(
            r.score for r in agent_results.values() if r.status == "success"
        ) / max(1, sum(1 for r in agent_results.values() if r.status == "success"))

        if total_red_flags >= 10 or avg_score < 30:
            return RiskLevel.CRITICAL.value
        elif total_red_flags >= 5 or avg_score < 50:
            return RiskLevel.HIGH.value
        elif total_red_flags >= 2 or avg_score < 65:
            return RiskLevel.MEDIUM.value
        else:
            return RiskLevel.LOW.value

    async def _get_llm_synthesis(
        self,
        agent_results: dict[str, AgentResult],
        debate_result: Optional[AgentResult],
        proposal_summary: str,
        weighted_score: float,
    ) -> dict:
        """Get LLM-generated qualitative synthesis."""
        llm = get_llm_client()

        user_content = f"Weighted Overall Score: {weighted_score:.1f}/100\n\n"

        if proposal_summary:
            user_content += f"Proposal Summary:\n{proposal_summary[:2000]}\n\n"

        user_content += "Parameter Scores:\n"
        param_display = {
            "ProblemRelevanceAgent": "Problem Relevance (15%)",
            "SolutionReadinessAgent": "Solution Readiness (20%)",
            "PilotDesignAgent": "Pilot Design (20%)",
            "FarmerAdoptionAgent": "Farmer Adoption (15%)",
            "ScaleUpAgent": "Scale-up Potential (15%)",
            "TeamCapacityAgent": "Team Capacity (10%)",
            "ComplianceAgent": "Compliance (5%)",
        }

        for agent_name, display in param_display.items():
            result = agent_results.get(agent_name)
            if result and result.status == "success":
                user_content += f"- {display}: {result.score:.1f}/100\n"
                if result.key_findings:
                    user_content += f"  Key: {', '.join(result.key_findings[:3])}\n"
                if result.red_flags:
                    user_content += f"  Flags: {', '.join(result.red_flags[:3])}\n"

        if debate_result and debate_result.status == "success":
            user_content += f"\nDebate Analysis:\n{debate_result.analysis[:1000]}\n"

        try:
            response = llm.chat(
                system_prompt=SCORING_SYSTEM_PROMPT,
                user_content=user_content,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            return response["result"]
        except Exception as e:
            logger.error("llm_synthesis_failed", error=str(e))
            return {
                "summary": f"Automated evaluation completed with overall score: {weighted_score:.1f}/100",
                "strengths": [],
                "weaknesses": [],
                "swot_analysis": {},
                "key_action_items": [],
                "investment_readiness": "",
            }
