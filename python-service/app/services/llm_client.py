"""
Unified LLM client supporting Groq (primary) with abstraction for future providers.
Handles retries, rate limiting, and JSON response parsing.
"""

import json
import time
from typing import Any, Optional

from groq import Groq
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Exceptions that should trigger retry
RETRYABLE_ERRORS = (Exception,)


class LLMClient:
    """Unified LLM client with retry logic and JSON response parsing."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ):
        self.api_key = api_key or settings.GROQ_API_KEY
        self.model = model or settings.LLM_MODEL
        self.temperature = temperature if temperature is not None else settings.LLM_TEMPERATURE
        self.max_tokens = max_tokens or settings.LLM_MAX_TOKENS

        if not self.api_key:
            raise ValueError("GROQ_API_KEY is required. Set it in .env or pass it directly.")

        self._client = Groq(api_key=self.api_key)

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=60),
        retry=retry_if_exception_type(RETRYABLE_ERRORS),
        before_sleep=lambda retry_state: get_logger(__name__).warning(
            "llm_retry",
            attempt=retry_state.attempt_number,
            wait=retry_state.next_action.sleep,
        ),
    )
    def chat(
        self,
        system_prompt: str,
        user_content: str,
        *,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        json_mode: bool = True,
    ) -> dict[str, Any]:
        """
        Send a chat completion request and return parsed response.

        Args:
            system_prompt: The system instruction.
            user_content: The user message content.
            model: Override model for this call.
            temperature: Override temperature.
            max_tokens: Override max tokens.
            json_mode: If True, request JSON response format.

        Returns:
            Dict with keys: result (parsed JSON), tokens (int), duration_ms (int)
        """
        start_time = time.time()

        use_model = model or self.model
        use_temp = temperature if temperature is not None else self.temperature
        use_max_tokens = max_tokens or self.max_tokens

        messages = [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_content,
            },
        ]

        kwargs: dict[str, Any] = {
            "messages": messages,
            "model": use_model,
            "temperature": use_temp,
            "max_tokens": use_max_tokens,
        }

        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            completion = self._client.chat.completions.create(**kwargs)
        except Exception as e:
            error_msg = str(e)
            # Check for rate limit errors specifically
            if "rate_limit" in error_msg.lower() or "429" in error_msg:
                logger.warning("rate_limited", model=use_model, error=error_msg)
                raise  # Will be retried by tenacity
            logger.error("llm_error", model=use_model, error=error_msg)
            raise

        duration_ms = int((time.time() - start_time) * 1000)
        response_text = completion.choices[0].message.content or "{}"
        tokens = completion.usage.total_tokens if completion.usage else 0

        # Parse JSON response
        result = self._parse_json_response(response_text)

        logger.info(
            "llm_call",
            model=use_model,
            tokens=tokens,
            duration_ms=duration_ms,
        )

        return {
            "result": result,
            "tokens": tokens,
            "duration_ms": duration_ms,
            "raw_text": response_text,
        }

    def _parse_json_response(self, text: str) -> dict[str, Any]:
        """Parse JSON from LLM response, handling common formatting issues."""
        text = text.strip()

        # Remove markdown code block wrappers if present
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to extract JSON from the text
            json_match = None
            brace_depth = 0
            start_idx = None
            for i, ch in enumerate(text):
                if ch == "{":
                    if brace_depth == 0:
                        start_idx = i
                    brace_depth += 1
                elif ch == "}":
                    brace_depth -= 1
                    if brace_depth == 0 and start_idx is not None:
                        json_match = text[start_idx : i + 1]
                        break

            if json_match:
                try:
                    return json.loads(json_match)
                except json.JSONDecodeError:
                    pass

            logger.warning("json_parse_failed", raw_text=text[:200])
            return {"error": "Failed to parse LLM response as JSON", "raw": text}


# Module-level singleton
_llm_client: Optional[LLMClient] = None


def get_llm_client() -> LLMClient:
    """Get or create the module-level LLM client singleton."""
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client
