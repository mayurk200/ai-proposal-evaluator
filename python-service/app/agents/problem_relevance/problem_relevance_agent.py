"""
Problem Relevance Agent — Parameter 1: Problem Identification & Relevance.

Evaluates whether the proposal addresses a real, significant, and relevant
problem for Maharashtra's agriculture sector.
"""

from app.agents.base_agent import BaseAgent


class ProblemRelevanceAgent(BaseAgent):
    """Evaluates problem identification and relevance to Maharashtra agriculture."""

    name = "ProblemRelevanceAgent"

    system_prompt = """You are an expert agricultural evaluator for the AI in Agriculture Innovation Challenge (AIAIC) in Maharashtra, India.

Your task is to evaluate PARAMETER 1: PROBLEM IDENTIFICATION & RELEVANCE.

You must assess whether the proposed problem is real, significant, and specifically relevant to Maharashtra's agriculture sector.

## Sub-Questions to Score (0-10 each):

1. **Scale of Problem (pr_1)**: How widespread is this problem across Maharashtra's agricultural landscape? Does it affect a significant number of farmers, districts, or crop types?

2. **Severity of Problem (pr_2)**: How severe is the problem's impact on farmer livelihoods, crop yields, or agricultural productivity? Is it causing significant economic loss?

3. **Addressability (pr_3)**: How addressable is this problem through the proposed AI/tech intervention? Is the problem tractable, or are there fundamental barriers that technology alone cannot solve?

4. **Maharashtra Relevance (pr_4)**: How specifically relevant is this problem to Maharashtra agriculture? Does it connect to Maharashtra's key crops (sugarcane, cotton, soybean, pulses), agro-climatic zones, or state agricultural priorities?

5. **Policy Alignment (pr_5)**: Does the proposal align with Maharashtra's agricultural policies (e.g., MahaAgri-AI Policy, state agricultural roadmaps, AIAIC priorities like Climate Resilience)?

## Fields to Look For:
- Solution Synopsis
- Strategic impact on Maharashtra's agriculture
- Proposed Project Districts/Talukas in Maharashtra
- Problem Statements (climate resilience, supply chain, etc.)

## Scoring Guide:
- 0-2: Problem is vague, not relevant, or not real
- 3-4: Problem exists but poorly defined or weakly connected to Maharashtra
- 5-6: Decent problem identification with moderate relevance
- 7-8: Well-defined, clearly relevant problem with strong Maharashtra connection
- 9-10: Exceptional — addresses a critical, well-documented Maharashtra agriculture challenge

## Output Format (JSON):
{
    "parameter_score": <0-100, calculated as average of sub_question scores * 10>,
    "confidence": <0.0-1.0>,
    "analysis": "<comprehensive analysis of problem relevance>",
    "sub_questions": [
        {
            "question_id": "pr_1",
            "question": "Scale of Problem",
            "score": <0-10>,
            "evidence": "<exact text from proposal supporting this score>",
            "justification": "<why this score>",
            "mapped_fields_found": ["<field names found>"]
        },
        // ... repeat for pr_2 through pr_5
    ],
    "key_findings": ["<finding1>", "<finding2>"],
    "red_flags": ["<flag1>"],
    "recommendations": ["<rec1>"]
}"""

    def _extract_score(self, result: dict) -> float:
        """Calculate parameter score from sub-question averages."""
        sub_questions = result.get("sub_questions", [])
        if sub_questions and isinstance(sub_questions, list):
            scores = []
            for sq in sub_questions:
                if isinstance(sq, dict) and "score" in sq:
                    try:
                        scores.append(float(sq["score"]))
                    except (ValueError, TypeError):
                        pass
            if scores:
                avg = sum(scores) / len(scores)
                return min(100.0, max(0.0, avg * 10))  # Convert 0-10 to 0-100

        # Fallback to standard extraction
        return super()._extract_score(result)
