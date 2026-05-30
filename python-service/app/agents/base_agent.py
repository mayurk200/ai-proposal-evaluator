"""
Base agent class with common functionality for all evaluation agents.
Provides retry logic, structured output parsing, validation,
timeout handling, and consistent error handling.
"""

import asyncio
import time
from typing import Any, Optional

from app.agents.validation import (
    AgentOutputSchema,
    ExtractionOutputSchema,
    validate_agent_output,
    clamp_score,
    parse_evidence_items,
)
from app.config import settings
from app.models.schemas import AgentResult
from app.services.llm.llm_client import get_llm_client
from app.utils.logging import get_logger

logger = get_logger(__name__)


class BaseAgent:
    """
    Base class for all evaluation agents.

    Each agent:
    - Has a name, system prompt, and configurable LLM parameters
    - Receives document chunks/summaries as input
    - Produces a validated AgentResult with scores, analysis, and findings
    - Handles errors gracefully and returns partial results
    - Has per-agent timeout protection
    - Validates all LLM output through Pydantic schemas
    """

    name: str = "BaseAgent"
    system_prompt: str = ""
    temperature: float = 0.3
    max_tokens: int = 4096
    validation_schema: type = AgentOutputSchema

    def __init__(
        self,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ):
        if temperature is not None:
            self.temperature = temperature
        if max_tokens is not None:
            self.max_tokens = max_tokens

    async def analyze(self, content: str, metadata: Optional[dict] = None) -> AgentResult:
        """
        Run the agent's analysis on the provided content.
        Wraps execution with timeout and retry logic.

        Args:
            content: The text content to analyze (chunks/summary).
            metadata: Optional document metadata for context.

        Returns:
            AgentResult with scores, analysis, and findings. Never raises.
        """
        start_time = time.time()
        logger.info("agent_started", agent=self.name)

        try:
            result = await asyncio.wait_for(
                self._execute_analysis(content, metadata, start_time),
                timeout=settings.AGENT_TIMEOUT_SECONDS,
            )
            return result
        except asyncio.TimeoutError:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.error(
                "agent_timeout",
                agent=self.name,
                timeout_seconds=settings.AGENT_TIMEOUT_SECONDS,
                duration_ms=duration_ms,
            )
            return AgentResult(
                agent_name=self.name,
                score=0.0,
                confidence=0.0,
                analysis=f"Agent timed out after {settings.AGENT_TIMEOUT_SECONDS}s",
                duration_ms=duration_ms,
                status="timeout",
                error=f"Timeout after {settings.AGENT_TIMEOUT_SECONDS}s",
                warnings=[f"Agent {self.name} timed out"],
            )
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.error(
                "agent_unexpected_error",
                agent=self.name,
                error=str(e)[:300],
                duration_ms=duration_ms,
            )
            return AgentResult(
                agent_name=self.name,
                score=0.0,
                confidence=0.0,
                analysis=f"Agent failed unexpectedly: {str(e)[:200]}",
                duration_ms=duration_ms,
                status="failed",
                error=str(e)[:300],
                warnings=[f"Agent {self.name} failed: {str(e)[:100]}"],
            )

    async def _execute_analysis(
        self, content: str, metadata: Optional[dict], start_time: float
    ) -> AgentResult:
        """
        Core analysis logic with one retry on failure.
        Separated from analyze() so timeout wraps the full attempt cycle.
        """
        last_error: Optional[Exception] = None

        for attempt in range(1 + settings.AGENT_MAX_RETRIES):
            try:
                return await self._single_attempt(content, metadata, start_time, attempt)
            except Exception as e:
                last_error = e
                if attempt < settings.AGENT_MAX_RETRIES:
                    logger.warning(
                        "agent_retry",
                        agent=self.name,
                        attempt=attempt + 1,
                        error=str(e)[:200],
                    )
                    await asyncio.sleep(2 ** attempt)  # Brief backoff between retries

        # All attempts exhausted
        duration_ms = int((time.time() - start_time) * 1000)
        logger.error(
            "agent_all_attempts_failed",
            agent=self.name,
            attempts=1 + settings.AGENT_MAX_RETRIES,
            error=str(last_error)[:300],
        )
        return AgentResult(
            agent_name=self.name,
            score=0.0,
            confidence=0.0,
            analysis=f"Agent failed after {1 + settings.AGENT_MAX_RETRIES} attempts: {str(last_error)[:200]}",
            duration_ms=duration_ms,
            status="failed",
            error=str(last_error)[:300],
            warnings=[f"All {1 + settings.AGENT_MAX_RETRIES} attempts failed for {self.name}"],
        )

    async def _single_attempt(
        self, content: str, metadata: Optional[dict], start_time: float, attempt: int
    ) -> AgentResult:
        """Execute a single LLM call attempt and validate the response."""
        llm = get_llm_client()

        # Build the user content with optional metadata context
        user_content = self._build_user_content(content, metadata)

        response = llm.chat(
            system_prompt=self.system_prompt,
            user_content=user_content,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )

        duration_ms = int((time.time() - start_time) * 1000)
        result = response["result"]

        # Check for parse errors from the LLM client
        if result.get("_parse_error"):
            raise ValueError(f"LLM returned unparseable response: {result.get('raw', '')[:200]}")

        # Validate through Pydantic schema
        validated, warnings = validate_agent_output(
            result, self.validation_schema, self.name
        )

        if warnings:
            for w in warnings:
                logger.warning("agent_validation_warning", agent=self.name, warning=w)

        # Extract evidence items
        evidence = parse_evidence_items(validated.get("evidence", []))

        agent_result = AgentResult(
            agent_name=self.name,
            score=clamp_score(self._extract_score(validated)),
            confidence=validated.get("confidence", 0.0),
            analysis=validated.get("analysis", ""),
            key_findings=validated.get("key_findings", []),
            red_flags=validated.get("red_flags", []),
            recommendations=validated.get("recommendations", []),
            raw_output=result,  # Keep original for debugging
            tokens_used=response["tokens"],
            duration_ms=duration_ms,
            status="success",
            evidence=evidence,
            warnings=warnings,
            missing_information=validated.get("missing_information", []),
        )

        logger.info(
            "agent_completed",
            agent=self.name,
            score=agent_result.score,
            confidence=agent_result.confidence,
            tokens=response["tokens"],
            duration_ms=duration_ms,
            attempt=attempt + 1,
            warning_count=len(warnings),
        )

        return agent_result

    def _build_user_content(self, content: str, metadata: Optional[dict]) -> str:
        """Build the user message with optional metadata prefix."""
        parts: list[str] = []

        if metadata:
            parts.append("Document Metadata:")
            parts.append(f"- Filename: {metadata.get('filename', 'unknown')}")
            parts.append(f"- Pages: {metadata.get('total_pages', 'unknown')}")
            parts.append(f"- Words: {metadata.get('total_words', 'unknown')}")
            if metadata.get('detected_sections'):
                parts.append(f"- Sections: {', '.join(metadata['detected_sections'])}")
            parts.append("")

        parts.append(content)
        return "\n".join(parts)

    def _extract_score(self, result: dict) -> float:
        """
        Extract the primary score from the agent's validated output.
        Subclasses can override this for custom score extraction.
        """
        # Try common score field names
        for key in ["score", "overall_score", f"{self.name.lower()}_score",
                     "total_score", "final_score"]:
            if key in result:
                try:
                    score = float(result[key])
                    return min(100.0, max(0.0, score))
                except (ValueError, TypeError):
                    continue
        return 0.0
