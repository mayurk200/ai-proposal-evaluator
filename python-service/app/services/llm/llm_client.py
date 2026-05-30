"""
Unified LLM client supporting Groq (primary) with abstraction for future providers.
Handles retries, rate limiting, timeout handling, and robust JSON response parsing.
"""

import json
import random
import re
import time
from typing import Any, Optional

from groq import Groq
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential_jitter,
    retry_if_exception_type,
    before_sleep_log,
)

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Retryable errors — only transient/server-side failures
# ---------------------------------------------------------------------------
class RetryableLLMError(Exception):
    """Wrapper for errors that should trigger a retry."""
    pass


class NonRetryableLLMError(Exception):
    """Wrapper for errors that should NOT be retried (bad request, auth, etc.)."""
    pass


def _classify_error(e: Exception) -> Exception:
    """
    Classify a Groq API error as retryable or non-retryable.
    Retryable: 429, 500, 502, 503, 504, timeout, connection errors.
    Non-retryable: 400, 401, 403, 422.
    """
    error_msg = str(e).lower()
    error_code = getattr(e, "status_code", None)

    # Rate limit
    if error_code == 429 or "rate_limit" in error_msg or "429" in error_msg:
        return RetryableLLMError(f"Rate limited: {e}")

    # Server errors
    if error_code in (500, 502, 503, 504):
        return RetryableLLMError(f"Server error ({error_code}): {e}")

    # Timeout / connection
    if any(kw in error_msg for kw in ("timeout", "timed out", "connection", "connect")):
        return RetryableLLMError(f"Network error: {e}")

    # Auth / bad request — do not retry
    if error_code in (400, 401, 403, 422):
        return NonRetryableLLMError(f"Client error ({error_code}): {e}")
    if "api_key" in error_msg or "unauthorized" in error_msg or "invalid" in error_msg:
        return NonRetryableLLMError(f"Auth error: {e}")

    # Default: treat as retryable (safe fallback)
    return RetryableLLMError(f"Unknown error (retrying): {e}")


class LLMClient:
    """Unified LLM client with retry logic, timeout handling, and robust JSON parsing."""

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
        wait=wait_exponential_jitter(initial=2, max=60, jitter=5),
        retry=retry_if_exception_type(RetryableLLMError),
        before_sleep=lambda retry_state: get_logger(__name__).warning(
            "llm_retry",
            attempt=retry_state.attempt_number,
            wait=round(getattr(retry_state.next_action, 'sleep', 0), 1),
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
            "timeout": settings.LLM_CALL_TIMEOUT_SECONDS,
        }

        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            completion = self._client.chat.completions.create(**kwargs)
        except Exception as e:
            classified = _classify_error(e)
            logger.warning(
                "llm_call_error",
                model=use_model,
                error_type=type(classified).__name__,
                error=str(e)[:200],
            )
            raise classified from e

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
        """
        Robust JSON extraction from LLM response.

        Handles: markdown wrappers, trailing commas, single quotes,
        truncated responses, multi-JSON, and garbage text.
        """
        text = text.strip()

        # Step 1: Remove markdown code block wrappers
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        # Step 2: Direct parse attempt
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Step 3: Fix trailing commas and retry
        cleaned = re.sub(r',\s*([}\]])', r'\1', text)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Step 4: Extract first complete JSON object via brace-matching
        json_obj = self._extract_json_object(text)
        if json_obj is not None:
            return json_obj

        # Step 5: Try with trailing comma fix on extracted text
        json_obj = self._extract_json_object(cleaned)
        if json_obj is not None:
            return json_obj

        # Step 6: Try single-quote replacement (last resort, can break strings)
        try:
            sq_text = cleaned.replace("'", '"')
            return json.loads(sq_text)
        except json.JSONDecodeError:
            pass

        # Step 7: Try to repair truncated JSON (close open braces/brackets)
        repaired = self._repair_truncated_json(cleaned)
        if repaired is not None:
            return repaired

        logger.warning("json_parse_failed", raw_text=text[:300])
        return {"_parse_error": True, "raw": text[:500]}

    def _extract_json_object(self, text: str) -> Optional[dict]:
        """Extract the first complete JSON object from text using brace-matching."""
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
                    candidate = text[start_idx: i + 1]
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        # Try fixing trailing commas in candidate
                        fixed = re.sub(r',\s*([}\]])', r'\1', candidate)
                        try:
                            return json.loads(fixed)
                        except json.JSONDecodeError:
                            pass
                    # Reset and try next object
                    start_idx = None

        return None

    def _repair_truncated_json(self, text: str) -> Optional[dict]:
        """
        Attempt to repair truncated JSON by closing open braces/brackets.
        Only works for simple truncation (e.g., response cut off mid-object).
        """
        # Find the start of JSON
        start = text.find("{")
        if start == -1:
            return None

        candidate = text[start:]

        # Count unmatched braces/brackets
        open_braces = candidate.count("{") - candidate.count("}")
        open_brackets = candidate.count("[") - candidate.count("]")

        if open_braces <= 0 and open_brackets <= 0:
            return None  # Not truncated, just malformed

        if open_braces > 5 or open_brackets > 5:
            return None  # Too badly damaged

        # Strip trailing comma if present
        candidate = candidate.rstrip()
        if candidate.endswith(","):
            candidate = candidate[:-1]

        # Close open brackets then braces
        candidate += "]" * open_brackets
        candidate += "}" * open_braces

        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            # Try with trailing comma fix too
            fixed = re.sub(r',\s*([}\]])', r'\1', candidate)
            try:
                return json.loads(fixed)
            except json.JSONDecodeError:
                return None


# Module-level singleton
_llm_client: Optional[LLMClient] = None


def get_llm_client() -> LLMClient:
    """Get or create the module-level LLM client singleton."""
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client
