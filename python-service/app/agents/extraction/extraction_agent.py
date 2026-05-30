"""
Extraction Agent — Extracts structured data from proposal documents.
Identifies key fields: startup name, team, problem, solution, market, financials, tech stack, etc.
"""

from app.agents.base_agent import BaseAgent
from app.agents.validation import ExtractionOutputSchema


class ExtractionAgent(BaseAgent):
    name = "ExtractionAgent"
    temperature = 0.1
    max_tokens = 4096
    validation_schema = ExtractionOutputSchema

    system_prompt = """You are an expert document analysis agent specializing in startup and vendor proposal extraction.

Your task is to extract and structure ALL key information from the provided proposal text. Be thorough and precise.

Extract the following information:
1. Startup/Company Name
2. Founders/Team Members (names, roles, experience)
3. Problem Statement (what problem they're solving)
4. Proposed Solution (how they solve it)
5. Target Market (who are the customers)
6. Industry/Sector (e.g., AgriTech, FinTech, HealthTech, etc.)
7. Business Model (how they make money)
8. Revenue Streams (specific revenue sources)
9. Funding Requirements (how much they need and for what)
10. Current Traction (users, revenue, partnerships, pilots)
11. Technology Stack (technologies, frameworks, platforms)
12. Sustainability Approach
13. Competitive Advantages (moat, differentiation)
14. Key Metrics/KPIs mentioned
15. Timeline/Milestones
16. Team Size and Composition
17. Geographic Focus
18. Partnerships/Collaborations mentioned

CRITICAL RULES:
- Extract ONLY what is explicitly stated in the document
- If information is NOT found, use "Not specified" or empty array
- Do NOT infer or make up information
- Note any vague or ambiguous claims in "unclear_claims"

Return your response as a valid JSON object:
{
    "score": 0,
    "startup_name": "",
    "founders": [{"name": "", "role": "", "experience": ""}],
    "problem_statement": "",
    "proposed_solution": "",
    "target_market": "",
    "industry_sector": "",
    "business_model": "",
    "revenue_streams": [],
    "funding_requirements": "",
    "current_traction": "",
    "technology_used": [],
    "sustainability_approach": "",
    "competitive_advantages": [],
    "key_metrics": [],
    "timeline": [],
    "team_size": "",
    "geographic_focus": "",
    "partnerships": [],
    "unclear_claims": [],
    "missing_critical_info": [],
    "analysis": "Brief assessment of the proposal's completeness and clarity",
    "key_findings": [],
    "red_flags": [],
    "confidence": 0.0
}"""

    def _extract_score(self, result: dict) -> float:
        """Score based on completeness of extracted information."""
        fields_present = 0
        total_fields = 15
        key_fields = [
            "startup_name", "problem_statement", "proposed_solution",
            "target_market", "business_model", "technology_used",
            "funding_requirements", "current_traction", "competitive_advantages",
            "revenue_streams", "founders", "key_metrics",
            "timeline", "industry_sector", "sustainability_approach",
        ]

        for field in key_fields:
            value = result.get(field)
            if value and value != "Not specified" and value != []:
                fields_present += 1

        score = result.get("score", (fields_present / total_fields) * 100)
        return min(100.0, max(0.0, float(score)))
