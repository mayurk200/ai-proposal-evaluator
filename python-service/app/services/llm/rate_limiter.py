"""
Tokens-per-minute budgeting for the LLM.

Groq enforces a rolling per-minute token budget, and it counts
`input_tokens + max_tokens` — the *reservation*, not what you end up using. Two
distinct failures come out of that, and the previous code walked into both:

  1. **A single request larger than the whole budget** gets a hard 413. No amount
     of retrying fixes it: the request is simply too big and always will be. Our
     metadata call asked for 7,273 tokens against a 6,000 ceiling.

  2. **Several requests that individually fit, but together do not.** Firing the
     seven parameter agents concurrently would have burst ~28,000 tokens into a
     12,000/minute budget. Groq answers with 429s, tenacity backs off, and the
     agents end up serialised anyway — but only after wasting several minutes
     discovering it.

This limiter fixes both by making the budget explicit: a request waits until the
rolling window has room for it, and a request that could never fit is rejected up
front with an error that says so, rather than being retried into the ground.

The limits are configuration, not constants. On the free tier this paces work; raise
the tier and raise the numbers and the same code goes as fast as the account allows.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Optional

from app.utils.logging import get_logger

logger = get_logger(__name__)

WINDOW_SECONDS = 60.0

# Leave headroom. Our token estimate is close but not exact (Groq's tokenizer is not
# ours), and hitting the ceiling dead-on means an occasional 429 for the sake of a
# few percent of throughput.
SAFETY_FACTOR = 0.90


class TokenBudgetExceeded(RuntimeError):
    """A single request is larger than the entire per-minute budget."""


class RateLimiter:
    """
    A rolling-window token budget for one model.

    Not a token bucket: Groq's window is a true rolling 60s, so we keep the actual
    (timestamp, tokens) spends and expire them as they age out.
    """

    def __init__(self, tokens_per_minute: int, name: str = "") -> None:
        self.limit = int(tokens_per_minute * SAFETY_FACTOR)
        self.name = name
        self._spends: deque[tuple[float, int]] = deque()
        self._lock = asyncio.Lock()

    def _expire(self, now: float) -> None:
        cutoff = now - WINDOW_SECONDS
        while self._spends and self._spends[0][0] < cutoff:
            self._spends.popleft()

    def _in_window(self) -> int:
        return sum(tokens for _, tokens in self._spends)

    async def acquire(self, tokens: int) -> None:
        """
        Block until `tokens` fit in the rolling window, then record the spend.

        Raises TokenBudgetExceeded if the request could never fit — waiting would be
        pointless, and the caller needs to shrink the request instead.
        """
        if tokens > self.limit:
            raise TokenBudgetExceeded(
                f"A single {self.name} request needs {tokens} tokens but the per-minute "
                f"budget is only {self.limit}. Reduce the context or max_tokens — "
                f"waiting cannot help."
            )

        while True:
            async with self._lock:
                now = time.monotonic()
                self._expire(now)
                used = self._in_window()

                if used + tokens <= self.limit:
                    self._spends.append((now, tokens))
                    return

                # Wait for the oldest spend to age out of the window — that is the
                # soonest any capacity can appear.
                oldest_at = self._spends[0][0]
                wait = max(0.1, (oldest_at + WINDOW_SECONDS) - now + 0.1)

            logger.info(
                "tpm_throttled",
                model=self.name,
                used=used,
                requested=tokens,
                limit=self.limit,
                waiting_seconds=round(wait, 1),
            )
            await asyncio.sleep(wait)

    async def reconcile(self, reserved: int, actual: int) -> None:
        """
        Replace a reservation with what the call actually cost.

        We reserve `input + max_tokens`, but a model that answers in 400 tokens when
        it was allowed 2,000 has not spent 2,000. Without this the budget drifts
        pessimistic and we throttle ourselves far harder than Groq would.
        """
        if actual >= reserved:
            return

        async with self._lock:
            for i in range(len(self._spends) - 1, -1, -1):
                timestamp, tokens = self._spends[i]
                if tokens == reserved:
                    self._spends[i] = (timestamp, actual)
                    return

    def capacity_now(self) -> int:
        self._expire(time.monotonic())
        return max(0, self.limit - self._in_window())


_limiters: dict[str, RateLimiter] = {}


def get_rate_limiter(model: str, tokens_per_minute: int) -> RateLimiter:
    """One limiter per model — the budgets are enforced per model, not per account."""
    limiter = _limiters.get(model)
    if limiter is None:
        limiter = RateLimiter(tokens_per_minute, name=model)
        _limiters[model] = limiter
        logger.info("rate_limiter_created", model=model, tpm=limiter.limit)
    return limiter


def reset_rate_limiters() -> None:
    """Used by tests."""
    _limiters.clear()
