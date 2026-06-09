"""
Base agent class with common functionality for all evaluation agents.
Provides retry logic, structured output parsing, and consistent error handling.
"""

import time
from typing import Any, Optional

from app.models.schemas import AgentResult, SubQuestionResult
from app.services.llm.llm_client import get_llm_client
from app.utils.logging import get_logger

logger = get_logger(__name__)


class BaseAgent:
    """
    Base class for all evaluation agents.

    Each agent:
    - Has a name, system prompt, and configurable LLM parameters
    - Receives document chunks/summaries as input
    - Produces an AgentResult with scores, analysis, and findings
    - Handles errors gracefully and returns partial results
    """

    name: str = "BaseAgent"
    system_prompt: str = ""
    temperature: float = 0.3
    max_tokens: int = 4096

    def __init__(
        self,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ):
        if temperature is not None:
            self.temperature = temperature
        if max_tokens is not None:
            self.max_tokens = max_tokens

        # Centralized mapping for parameter-specific context pruning to satisfy Groq TPM/rate limits
        name = self.__class__.__name__
        self.relevant_fields = []
        self.relevant_chunk_keywords = []

        if name == "ProblemRelevanceAgent":
            self.relevant_fields = [
                "problem_statement", "solution_synopsis", "company_name", "project_name",
                "application_track", "maharashtra_strategic_impact", "farmer_centric_benefits",
                "farmer_count_target"
            ]
            self.relevant_chunk_keywords = ["problem", "relevance", "challenge", "farmer", "agriculture", "introduction", "synopsis", "district"]
        elif name == "SolutionReadinessAgent":
            self.relevant_fields = [
                "solution_synopsis", "technology_details", "trl_level", "ip_status",
                "data_sources_used", "open_source_technologies", "project_name"
            ]
            self.relevant_chunk_keywords = ["solution", "technology", "trl", "innovation", "ip", "patent", "readiness", "technical", "stack", "data"]
        elif name == "PilotDesignAgent":
            self.relevant_fields = [
                "project_duration_months", "total_project_cost_inr", "workplan_milestones",
                "risk_assessment", "risk_mitigation", "training_capacity_plan", "expected_outputs",
                "baseline_values", "proposed_districts"
            ]
            self.relevant_chunk_keywords = ["pilot", "milestone", "workplan", "timeline", "district", "schedule", "implementation", "duration", "cost", "budget", "risk"]
        elif name == "FarmerAdoptionAgent":
            self.relevant_fields = [
                "farmer_centric_benefits", "pricing_strategy", "gender_social_inclusion_plan",
                "training_capacity_plan", "farmer_count_target"
            ]
            self.relevant_chunk_keywords = ["farmer", "adoption", "gender", "youth", "inclusion", "pricing", "benefit", "training", "capacity"]
        elif name == "ScaleUpAgent":
            self.relevant_fields = [
                "revenue_model", "business_sustainability", "market_size", "go_to_market_strategy",
                "current_customers_pilots", "revenue_data", "funding_raised", "unit_economics",
                "committed_pipeline", "prior_govt_collaboration"
            ]
            self.relevant_chunk_keywords = ["scale", "revenue", "financial", "budget", "business model", "commercial", "market", "pricing", "customer", "traction"]
        elif name == "TeamCapacityAgent":
            self.relevant_fields = [
                "founders", "core_team", "company_name"
            ]
            self.relevant_chunk_keywords = ["team", "founder", "leadership", "experience", "qualification", "capacity", "credentials", "resume"]
        elif name == "ComplianceAgent":
            self.relevant_fields = [
                "dpdp_compliance", "model_safety_practices"
            ]
            self.relevant_chunk_keywords = ["compliance", "standard", "safety", "dpdp", "regulation", "legal", "certification", "ethics"]

    async def analyze(
        self,
        content: str,
        metadata: Optional[dict] = None,
        form_fields: Optional[dict] = None,
        chunks: Optional[list[Any]] = None,
    ) -> AgentResult:
        """
        Run the agent's analysis on the provided content.

        Args:
            content: The text content to analyze (chunks/summary).
            metadata: Optional document metadata for context.
            form_fields: Optional structured form fields from AIAIC extraction.
            chunks: Optional list of DocumentChunk objects for smart filtering.

        Returns:
            AgentResult with scores, analysis, and findings.
        """
        start_time = time.time()
        llm = get_llm_client()

        # Build the user content with optional metadata context
        user_content = ""
        if metadata:
            user_content += "Document Metadata:\n"
            user_content += f"- Filename: {metadata.get('filename', 'unknown')}\n"
            user_content += f"- Pages: {metadata.get('total_pages', 'unknown')}\n"
            user_content += f"- Words: {metadata.get('total_words', 'unknown')}\n"
            if metadata.get('detected_sections'):
                user_content += f"- Sections: {', '.join(metadata['detected_sections'])}\n"
            user_content += "\n"

        # Add filtered form field context if available
        if form_fields:
            user_content += self._build_form_fields_context(form_fields)

        # Smart-filter chunks if available to prevent token payload bloat for parameter agents
        if chunks and self.name != "ExtractionAgent":
            user_content += self._filter_chunks_for_agent_new(chunks)
        else:
            user_content += content

        # Enforce maximum safety limit for total user content (e.g. truncate if somehow still huge)
        if len(user_content) > 30000:
            user_content = user_content[:30000] + "\n... [TRUNCATED DUE TO SIZE LIMITS] ..."

        try:
            response = llm.chat(
                system_prompt=self.system_prompt,
                user_content=user_content,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )

            duration_ms = int((time.time() - start_time) * 1000)
            result = response["result"]

            agent_result = AgentResult(
                agent_name=self.name,
                score=self._extract_score(result),
                confidence=result.get("confidence", 0.0),
                analysis=result.get("analysis", ""),
                key_findings=result.get("key_findings", []),
                red_flags=result.get("red_flags", []),
                recommendations=result.get("recommendations", []),
                sub_questions=self._extract_sub_questions(result),
                raw_output=result,
                tokens_used=response["tokens"],
                duration_ms=duration_ms,
                status="success",
            )

            logger.info(
                "agent_completed",
                agent=self.name,
                score=agent_result.score,
                tokens=response["tokens"],
                duration_ms=duration_ms,
            )

            return agent_result

        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.error("agent_failed", agent=self.name, error=str(e))

            return AgentResult(
                agent_name=self.name,
                score=0.0,
                analysis=f"Agent failed: {str(e)}",
                duration_ms=duration_ms,
                status="failed",
                error=str(e),
            )

    def _extract_score(self, result: dict) -> float:
        """
        Extract the primary score from the agent's raw output.
        Subclasses can override this for custom score extraction.
        """
        # Try common score field names
        for key in ["score", "overall_score", f"{self.name.lower()}_score",
                     "total_score", "final_score", "parameter_score"]:
            if key in result:
                try:
                    score = float(result[key])
                    return min(100.0, max(0.0, score))
                except (ValueError, TypeError):
                    continue
        return 0.0

    def _extract_sub_questions(self, result: dict) -> list[SubQuestionResult]:
        """
        Extract sub-question scores from the agent's raw output.

        Expects result to contain a 'sub_questions' list with dicts having:
        question_id, question, score (0-10), evidence, justification
        """
        sub_questions = result.get("sub_questions", [])
        if not isinstance(sub_questions, list):
            return []

        parsed = []
        for sq in sub_questions:
            if not isinstance(sq, dict):
                continue
            try:
                score = float(sq.get("score", 0))
                # Clamp to 0-10 range
                score = min(10.0, max(0.0, score))
                parsed.append(SubQuestionResult(
                    question_id=str(sq.get("question_id", "")),
                    question=str(sq.get("question", "")),
                    score=score,
                    evidence=str(sq.get("evidence", "")),
                    justification=str(sq.get("justification", "")),
                    mapped_fields_found=sq.get("mapped_fields_found", []),
                ))
            except (ValueError, TypeError):
                continue

        return parsed

    def _build_form_fields_context(self, form_fields: dict) -> str:
        """
        Build a context string from extracted form fields.
        Only includes fields relevant to this specific agent to save tokens.
        """
        fields = form_fields.get("fields", {})
        if not fields:
            return ""

        context = "=== EXTRACTED FORM FIELDS ===\n\n"
        has_fields = False
        for field_name, value in fields.items():
            # Filter fields if self.relevant_fields is set
            if self.relevant_fields and field_name not in self.relevant_fields:
                continue
            if value and value.strip() and value != "NOT FOUND":
                has_fields = True
                # Truncate very long values
                display_value = value[:2000] + "..." if len(value) > 2000 else value
                context += f"[{field_name}]:\n{display_value}\n\n"
        context += "=== END FORM FIELDS ===\n\n"
        return context if has_fields else ""

    def _filter_chunks_for_agent_new(self, chunks: list[Any]) -> str:
        """Filter chunks based on keyword matching for the specific parameter agent."""
        if not self.relevant_chunk_keywords:
            return "\n\n---\n\n".join(c.text for c in chunks)

        relevant_parts = []
        # Always include the first 2 chunks (Introduction/Identity/Metadata context)
        for i, chunk in enumerate(chunks[:2]):
            relevant_parts.append(f"[Section: {chunk.section_title} (Intro Context)]\n{chunk.text}")

        matched_count = 0
        for chunk in chunks[2:]:
            section_lower = (chunk.section_title or "").lower()
            text_lower = (chunk.text or "").lower()

            is_relevant = False
            for kw in self.relevant_chunk_keywords:
                # Check for keyword in section title, or multiple times in chunk text
                if kw in section_lower or (kw in text_lower and text_lower.count(kw) >= 2):
                    is_relevant = True
                    break

            if is_relevant:
                header = f"[Section: {chunk.section_title}]"
                if chunk.page_numbers:
                    header += f" [Pages: {', '.join(str(p) for p in chunk.page_numbers)}]"
                relevant_parts.append(f"{header}\n{chunk.text}")
                matched_count += 1

        # Fallback if no relevant chunks are found: include the first 3 additional chunks
        if matched_count == 0 and len(chunks) > 2:
            for chunk in chunks[2:5]:
                header = f"[Section: {chunk.section_title}]"
                relevant_parts.append(f"{header}\n{chunk.text}")

        return "\n\n---\n\n".join(relevant_parts)

    def _filter_chunks_for_agent(
        self, chunks: list[dict], content_type: Optional[str] = None
    ) -> str:
        """Legacy helper — kept for backward compatibility."""
        if not content_type:
            return "\n\n---\n\n".join(c.get("text", "") for c in chunks)

        relevant = []
        for chunk in chunks:
            if content_type == "financial" and chunk.get("has_financial_data"):
                relevant.append(chunk)
            elif content_type == "technical" and chunk.get("has_technical_content"):
                relevant.append(chunk)

        if not relevant:
            relevant = chunks

        return "\n\n---\n\n".join(c.get("text", "") for c in relevant)

