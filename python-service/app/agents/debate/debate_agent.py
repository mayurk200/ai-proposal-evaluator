"""
Debate Agent — Cross-agent conflict resolution and precision scoring.

This meta-agent analyzes results from all 7 parameter agents to detect
contradictions, run parallel pro/con arguments, and produce score
adjustments for more precise evaluation.
"""

import time
from typing import Optional

from app.models.schemas import AgentResult, DebateResult
from app.services.llm.llm_client import get_llm_client
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Score variance threshold for triggering debate on a parameter pair
VARIANCE_THRESHOLD = 3.0  # On 0-10 scale

# Known cross-parameter conflict patterns to watch for
CONFLICT_PATTERNS = [
    {
        "id": "tech_vs_pilot",
        "agent_a": "SolutionReadinessAgent",
        "agent_b": "PilotDesignAgent",
        "description": "High technical maturity but unrealistic pilot plan",
        "trigger": "score_gap",
    },
    {
        "id": "revenue_vs_affordability",
        "agent_a": "ScaleUpAgent",
        "agent_b": "FarmerAdoptionAgent",
        "description": "Strong revenue model but poor farmer affordability",
        "trigger": "sub_question_conflict",
        "sq_a": "su_1",  # Revenue Model
        "sq_b": "fa_2",  # Affordability
    },
    {
        "id": "team_vs_plan",
        "agent_a": "TeamCapacityAgent",
        "agent_b": "PilotDesignAgent",
        "description": "Small/weak team but ambitious implementation plan",
        "trigger": "inverse_correlation",
    },
    {
        "id": "value_vs_evidence",
        "agent_a": "FarmerAdoptionAgent",
        "agent_b": "SolutionReadinessAgent",
        "description": "Strong value claims but no pilot evidence",
        "trigger": "sub_question_conflict",
        "sq_a": "fa_1",  # Value Proposition
        "sq_b": "sr_3",  # Solution Readiness (prior pilots)
    },
    {
        "id": "innovation_vs_compliance",
        "agent_a": "SolutionReadinessAgent",
        "agent_b": "ComplianceAgent",
        "description": "Advanced AI claims but poor data governance",
        "trigger": "score_gap",
    },
    {
        "id": "scale_vs_inclusion",
        "agent_a": "ScaleUpAgent",
        "agent_b": "FarmerAdoptionAgent",
        "description": "Good GTM strategy but poor social inclusion",
        "trigger": "sub_question_conflict",
        "sq_a": "su_5",  # GTM
        "sq_b": "fa_3",  # Social Inclusion
    },
]

DEBATE_SYSTEM_PROMPT = """You are an expert meta-evaluator for the AI in Agriculture Innovation Challenge (AIAIC).

You receive evaluation results from 7 specialized parameter agents. Your role is to:

1. **Identify Contradictions**: Find cases where agent scores or findings conflict with each other
2. **Debate Both Sides**: For each contradiction, present the EVIDENCE-BASED argument from each agent's perspective
3. **Resolve Conflicts**: Determine which agent's assessment is better supported by evidence
4. **Produce Score Adjustments**: Recommend specific score adjustments (+/- on 0-10 scale per sub-question) with documented reasoning
5. **Flag High Ambiguity**: Identify areas where additional information would significantly change the evaluation

## Rules:
- ONLY recommend adjustments when there is clear evidence of contradiction
- Keep adjustments small (typically ±0.5 to ±2.0 points)
- Always cite specific evidence from the agent findings
- If agents agree and evidence is consistent, confirm scores are appropriate
- Focus on MATERIAL contradictions, not minor stylistic differences

## Output Format (JSON):
{
    "conflicts_found": [
        {
            "conflict_id": "<id>",
            "description": "<what the conflict is>",
            "agent_a": "<name>",
            "agent_b": "<name>",
            "severity": "<low|medium|high>"
        }
    ],
    "debates": [
        {
            "conflict_id": "<id>",
            "topic": "<what is being debated>",
            "position_a": {
                "agent": "<name>",
                "argument": "<evidence-based argument>",
                "evidence": "<specific text cited>"
            },
            "position_b": {
                "agent": "<name>",
                "argument": "<evidence-based argument>",
                "evidence": "<specific text cited>"
            },
            "resolution": "<which position is better supported and why>",
            "score_adjustments": [
                {
                    "parameter": "<parameter name>",
                    "sub_question_id": "<sq_id>",
                    "current_score": <0-10>,
                    "adjusted_score": <0-10>,
                    "adjustment": <delta>,
                    "reason": "<why>"
                }
            ]
        }
    ],
    "adjusted_scores": {
        "<parameter_name>": <adjusted 0-100 score>,
        ...
    },
    "high_ambiguity_areas": [
        "<description of area where more info is needed>"
    ],
    "confidence": <0.0-1.0>,
    "analysis": "<overall meta-analysis of evaluation consistency>"
}"""


class DebateAgent:
    """
    Meta-agent that cross-checks parameter agent results for contradictions
    and produces score adjustments through evidence-based debate.
    """

    name = "DebateAgent"

    def __init__(self, temperature: float = 0.2, max_tokens: int = 4096):
        self.temperature = temperature
        self.max_tokens = max_tokens

    def should_trigger(self, agent_results: dict[str, AgentResult]) -> bool:
        """
        Determine whether the debate agent should run based on agent results.

        Triggers when:
        - Score variance across related parameters exceeds threshold
        - Red flags from one agent contradict high scores from another
        - Borderline overall score (40-60 range on 0-100 scale)
        - Always runs (can be configured to skip for clear-cut cases)
        """
        if len(agent_results) < 3:
            return False

        scores = [r.score for r in agent_results.values() if r.status == "success"]
        if not scores:
            return False

        # Check for high variance
        avg_score = sum(scores) / len(scores)
        max_diff = max(abs(s - avg_score) for s in scores)
        if max_diff > 20:  # >20 point difference from mean on 0-100 scale
            return True

        # Check for borderline overall score
        if 35 <= avg_score <= 65:
            return True

        # Check for red flags contradicting high scores
        for name, result in agent_results.items():
            if result.red_flags and result.score > 70:
                return True

        # Check known conflict patterns
        for pattern in CONFLICT_PATTERNS:
            a_result = agent_results.get(pattern["agent_a"])
            b_result = agent_results.get(pattern["agent_b"])
            if a_result and b_result:
                score_diff = abs(a_result.score - b_result.score)
                if score_diff > VARIANCE_THRESHOLD * 10:  # Convert to 0-100 scale
                    return True

        # Default: always trigger for thorough evaluation
        return True

    async def analyze(
        self,
        agent_results: dict[str, AgentResult],
        proposal_summary: str = "",
    ) -> AgentResult:
        """
        Run debate analysis across all parameter agent results.

        Args:
            agent_results: Dict of agent_name -> AgentResult from parameter agents.
            proposal_summary: Optional executive summary for context.

        Returns:
            AgentResult containing the DebateResult in raw_output.
        """
        start_time = time.time()
        llm = get_llm_client()

        # Build the input with all agent results
        user_content = self._build_debate_input(agent_results, proposal_summary)

        try:
            response = llm.chat(
                system_prompt=DEBATE_SYSTEM_PROMPT,
                user_content=user_content,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )

            duration_ms = int((time.time() - start_time) * 1000)
            result = response["result"]

            # Parse debate-specific fields
            debate_result = DebateResult(
                conflicts=result.get("conflicts_found", []),
                debates=result.get("debates", []),
                adjusted_scores=result.get("adjusted_scores", {}),
                high_ambiguity_areas=result.get("high_ambiguity_areas", []),
                confidence=float(result.get("confidence", 0.5)),
            )

            agent_result = AgentResult(
                agent_name=self.name,
                score=0.0,  # Debate agent doesn't produce its own score
                confidence=debate_result.confidence,
                analysis=result.get("analysis", ""),
                key_findings=[
                    f"Conflicts found: {len(debate_result.conflicts)}",
                    f"Score adjustments: {len(debate_result.debates)}",
                    f"High ambiguity areas: {len(debate_result.high_ambiguity_areas)}",
                ],
                red_flags=[
                    c.get("description", "")
                    for c in debate_result.conflicts
                    if c.get("severity") == "high"
                ],
                recommendations=[],
                raw_output=result,
                tokens_used=response["tokens"],
                duration_ms=duration_ms,
                status="success",
            )

            logger.info(
                "debate_completed",
                conflicts=len(debate_result.conflicts),
                adjustments=len(debate_result.debates),
                tokens=response["tokens"],
                duration_ms=duration_ms,
            )

            return agent_result

        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.error("debate_failed", error=str(e))

            return AgentResult(
                agent_name=self.name,
                score=0.0,
                analysis=f"Debate agent failed: {str(e)}",
                duration_ms=duration_ms,
                status="failed",
                error=str(e),
            )

    def _build_debate_input(
        self,
        agent_results: dict[str, AgentResult],
        proposal_summary: str = "",
    ) -> str:
        """Build the input text for the debate agent LLM call."""
        parts = []

        if proposal_summary:
            parts.append(f"=== PROPOSAL SUMMARY ===\n{proposal_summary}\n")

        parts.append("=== PARAMETER AGENT RESULTS ===\n")

        for agent_name, result in agent_results.items():
            if result.status != "success":
                parts.append(f"\n--- {agent_name} [FAILED] ---\n")
                continue

            parts.append(f"\n--- {agent_name} (Score: {result.score}/100) ---")
            parts.append(f"Analysis: {result.analysis[:1500]}")

            if result.sub_questions:
                parts.append("Sub-question scores:")
                for sq in result.sub_questions:
                    parts.append(
                        f"  [{sq.question_id}] {sq.question}: "
                        f"{sq.score}/10 — {sq.justification[:200]}"
                    )

            if result.key_findings:
                parts.append(f"Key findings: {', '.join(result.key_findings[:5])}")

            if result.red_flags:
                parts.append(f"RED FLAGS: {', '.join(result.red_flags[:5])}")

            parts.append("")

        # Add known conflict patterns to check
        parts.append("\n=== KNOWN CONFLICT PATTERNS TO CHECK ===")
        for pattern in CONFLICT_PATTERNS:
            parts.append(f"- {pattern['description']} ({pattern['agent_a']} vs {pattern['agent_b']})")

        return "\n".join(parts)

    def apply_adjustments(
        self,
        agent_results: dict[str, AgentResult],
        debate_result: dict,
    ) -> dict[str, float]:
        """
        Apply debate-recommended score adjustments to agent results.

        Returns dict of parameter_name -> adjusted_score (0-100).
        """
        adjusted_scores = {}

        # Start with original scores
        for agent_name, result in agent_results.items():
            adjusted_scores[agent_name] = result.score

        # Apply debate adjustments
        debate_adjusted = debate_result.get("adjusted_scores", {})
        for param_name, adj_score in debate_adjusted.items():
            try:
                adj_score = float(adj_score)
                adj_score = min(100.0, max(0.0, adj_score))
                # Find matching agent
                for agent_name in adjusted_scores:
                    if param_name.lower() in agent_name.lower():
                        adjusted_scores[agent_name] = adj_score
                        break
            except (ValueError, TypeError):
                continue

        return adjusted_scores
