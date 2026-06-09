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

    async def analyze(
        self,
        content: str,
        metadata: Optional[dict] = None,
        form_fields: Optional[dict] = None,
    ) -> AgentResult:
        """
        Run the agent's analysis on the provided content.

        Args:
            content: The text content to analyze (chunks/summary).
            metadata: Optional document metadata for context.
            form_fields: Optional structured form fields from AIAIC extraction.

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

        # Add form field context if available
        if form_fields:
            user_content += self._build_form_fields_context(form_fields)

        user_content += content

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

        Agents can override this to select only relevant fields.
        """
        fields = form_fields.get("fields", {})
        if not fields:
            return ""

        context = "=== EXTRACTED FORM FIELDS ===\n\n"
        for field_name, value in fields.items():
            if value and value.strip():
                # Truncate very long values
                display_value = value[:2000] + "..." if len(value) > 2000 else value
                context += f"[{field_name}]:\n{display_value}\n\n"
        context += "=== END FORM FIELDS ===\n\n"
        return context

    def _filter_chunks_for_agent(
        self, chunks: list[dict], content_type: Optional[str] = None
    ) -> str:
        """
        Filter and combine chunks relevant to this agent.

        Args:
            chunks: List of chunk dicts.
            content_type: "financial", "technical", or None for all.

        Returns:
            Combined text from relevant chunks.
        """
        if not content_type:
            return "\n\n---\n\n".join(c.get("text", "") for c in chunks)

        relevant = []
        for chunk in chunks:
            if content_type == "financial" and chunk.get("has_financial_data"):
                relevant.append(chunk)
            elif content_type == "technical" and chunk.get("has_technical_content"):
                relevant.append(chunk)

        # If no specifically tagged chunks, include all
        if not relevant:
            relevant = chunks

        return "\n\n---\n\n".join(c.get("text", "") for c in relevant)

