"""
Async LLM client for Groq.

Two bugs in the previous version are fixed here, and both mattered a lot:

1. It used the *synchronous* `Groq` client and called it straight from `async`
   agent methods. Every LLM call — ten or more per evaluation, minutes in total —
   blocked the entire FastAPI event loop. Health checks stalled, the proposals
   list stalled, and concurrent background tasks serialised behind whichever one
   happened to be talking to Groq. `AsyncGroq` makes the service actually
   concurrent, which is the prerequisite for running the parameter agents in
   parallel at all.

2. `RETRYABLE_ERRORS = (Exception,)` meant *everything* was retried five times
   with up to 60s of backoff — including a bad API key, a malformed request, or a
   context-length overflow, none of which will ever succeed on a retry. A single
   deterministic failure could burn minutes per agent. We now retry only what is
   actually transient.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Optional

from groq import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncGroq,
    InternalServerError,
    RateLimitError,
)
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Transient by nature: rate limits, upstream 5xx, connection blips, timeouts.
# Everything else (401 bad key, 400 bad request, 413 context overflow) is
# deterministic and fails immediately.
RETRYABLE_ERRORS = (
    RateLimitError,
    InternalServerError,
    APIConnectionError,
    APITimeoutError,
)


class LLMError(RuntimeError):
    """Raised when the LLM cannot produce a usable response."""


class LLMClient:
    """Async Groq client with bounded concurrency and JSON-mode parsing."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ):
        self.api_key = api_key or settings.GROQ_API_KEY
        self.model = model or settings.LLM_MODEL
        self.temperature = (
            temperature if temperature is not None else settings.LLM_TEMPERATURE
        )
        self.max_tokens = max_tokens or settings.LLM_MAX_TOKENS

        if not self.api_key:
            raise ValueError("GROQ_API_KEY is required. Set it in .env.")

        self._client = AsyncGroq(api_key=self.api_key)

        # Groq bills per tokens-per-minute. Running all seven parameter agents at
        # once would blow the TPM ceiling and trigger a cascade of 429s that the
        # backoff then serialises anyway — so we cap in-flight calls instead of
        # discovering the limit the expensive way.
        self._semaphore = asyncio.Semaphore(settings.LLM_MAX_CONCURRENCY)

        # Rolling totals, surfaced per-evaluation so the cost of each optimisation
        # is measurable rather than assumed.
        self.total_tokens = 0

    async def chat(
        self,
        system_prompt: str,
        user_content: str,
        *,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        json_mode: bool = True,
        fast: bool = False,
    ) -> dict[str, Any]:
        """
        One chat completion.

        `fast=True` routes to the small model. Metadata extraction, sectioning and
        summarisation are structurally simple next to parameter judgment, and
        running them on the 70B model was paying a premium for no benefit — and
        eating the TPM budget the judgment agents need.
        """
        use_model = model or (settings.LLM_MODEL_FAST if fast else self.model)
        use_temp = temperature if temperature is not None else self.temperature
        use_max_tokens = max_tokens or self.max_tokens

        async with self._semaphore:
            return await self._chat_with_retry(
                system_prompt=system_prompt,
                user_content=user_content,
                model=use_model,
                temperature=use_temp,
                max_tokens=use_max_tokens,
                json_mode=json_mode,
            )

    @retry(
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type(RETRYABLE_ERRORS),
        reraise=True,
        before_sleep=lambda state: get_logger(__name__).warning(
            "llm_retry",
            attempt=state.attempt_number,
            wait=round(state.next_action.sleep, 1),
            error=str(state.outcome.exception())[:120],
        ),
    )
    async def _chat_with_retry(
        self,
        *,
        system_prompt: str,
        user_content: str,
        model: str,
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> dict[str, Any]:
        start = time.time()

        kwargs: dict[str, Any] = {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            completion = await self._client.chat.completions.create(**kwargs)
        except RETRYABLE_ERRORS as exc:
            logger.warning("llm_transient_error", model=model, error=str(exc)[:200])
            raise
        except APIStatusError as exc:
            # Deterministic: a retry would fail identically. Fail now and say why.
            logger.error(
                "llm_permanent_error",
                model=model,
                status=exc.status_code,
                error=str(exc)[:200],
            )
            raise LLMError(f"LLM rejected the request ({exc.status_code}): {exc}") from exc

        duration_ms = int((time.time() - start) * 1000)
        text = completion.choices[0].message.content or "{}"
        tokens = completion.usage.total_tokens if completion.usage else 0
        self.total_tokens += tokens

        logger.info("llm_call", model=model, tokens=tokens, duration_ms=duration_ms)

        return {
            "result": self._parse_json(text) if json_mode else {"text": text},
            "tokens": tokens,
            "duration_ms": duration_ms,
            "model": model,
            "raw_text": text,
        }

    def _parse_json(self, text: str) -> dict[str, Any]:
        """
        Parse a JSON body out of an LLM response.

        Even in JSON mode a model will occasionally wrap the object in a fence or
        prepend a sentence, so we strip fences and then, as a last resort, scan
        for the first balanced brace group.
        """
        text = text.strip()

        if text.startswith("```"):
            text = text.split("\n", 1)[-1] if "\n" in text else text[3:]
            if text.rstrip().endswith("```"):
                text = text.rstrip()[:-3]
            text = text.strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        depth = 0
        start_idx: Optional[int] = None
        for i, ch in enumerate(text):
            if ch == "{":
                if depth == 0:
                    start_idx = i
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and start_idx is not None:
                    try:
                        return json.loads(text[start_idx : i + 1])
                    except json.JSONDecodeError:
                        break

        logger.warning("json_parse_failed", raw=text[:200])
        raise LLMError("The model did not return parseable JSON.")


_client: Optional[LLMClient] = None


def get_llm_client() -> LLMClient:
    global _client
    if _client is None:
        _client = LLMClient()
    return _client


def reset_llm_client() -> None:
    """Used by tests."""
    global _client
    _client = None
