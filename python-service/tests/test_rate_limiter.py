"""
TPM budgeting.

Groq counts (input + max_tokens) against a rolling per-minute budget. Two failures
follow from that, and both were live bugs before this limiter existed:
  * a single request bigger than the budget -> hard 413, unretryable
  * concurrent requests that individually fit but together do not -> 429 storm
"""

import asyncio

import pytest

from app.services.llm.rate_limiter import (
    SAFETY_FACTOR,
    RateLimiter,
    TokenBudgetExceeded,
    get_rate_limiter,
    reset_rate_limiters,
)


@pytest.fixture(autouse=True)
def _reset():
    reset_rate_limiters()
    yield
    reset_rate_limiters()


class TestBudget:
    def test_limit_carries_safety_headroom(self):
        """
        Our token estimate is close but not identical to Groq's, so sitting exactly on
        the ceiling means an occasional 429 for a few percent of throughput.
        """
        limiter = RateLimiter(12_000, name="test")
        assert limiter.limit == int(12_000 * SAFETY_FACTOR)
        assert limiter.limit < 12_000

    @pytest.mark.asyncio
    async def test_requests_within_budget_do_not_block(self):
        limiter = RateLimiter(10_000, name="test")
        await asyncio.wait_for(limiter.acquire(3_000), timeout=1)
        await asyncio.wait_for(limiter.acquire(3_000), timeout=1)
        assert limiter.capacity_now() > 0

    @pytest.mark.asyncio
    async def test_oversized_request_is_rejected_not_queued(self):
        """
        A request larger than the entire per-minute budget can never succeed. Waiting
        for capacity that cannot exist would hang forever; retrying it would burn the
        backoff. Fail immediately and say what to change.
        """
        limiter = RateLimiter(6_000, name="fast-model")

        with pytest.raises(TokenBudgetExceeded, match="per-minute budget"):
            await limiter.acquire(7_273)   # the exact request that produced a live 413

    @pytest.mark.asyncio
    async def test_exhausted_budget_makes_the_next_caller_wait(self):
        limiter = RateLimiter(1_000, name="test")   # limit becomes 900
        await limiter.acquire(900)
        assert limiter.capacity_now() == 0

        # There is no room, so this must not return promptly.
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(limiter.acquire(500), timeout=0.5)

    @pytest.mark.asyncio
    async def test_reconcile_returns_unspent_reservation(self):
        """
        We reserve (input + max_tokens) but a model that answers briefly has not spent
        its whole allowance. Without giving the remainder back, the budget drifts
        pessimistic and we throttle ourselves far harder than Groq would.
        """
        limiter = RateLimiter(10_000, name="test")   # limit 9_000

        await limiter.acquire(5_000)          # reserved
        assert limiter.capacity_now() == 4_000

        await limiter.reconcile(5_000, 1_000)  # actually cost 1_000
        assert limiter.capacity_now() == 8_000

    @pytest.mark.asyncio
    async def test_reconcile_never_inflates_a_spend(self):
        limiter = RateLimiter(10_000, name="test")
        await limiter.acquire(2_000)
        before = limiter.capacity_now()

        await limiter.reconcile(2_000, 9_999)  # actual > reserved: ignore
        assert limiter.capacity_now() == before


class TestPerModelLimiters:
    def test_each_model_gets_its_own_budget(self):
        """
        Groq enforces TPM per model, not per account. Sharing one limiter across the
        70B and 8B models would throttle the cheap calls against the expensive ones.
        """
        big = get_rate_limiter("llama-3.3-70b-versatile", 12_000)
        small = get_rate_limiter("llama-3.1-8b-instant", 6_000)

        assert big is not small
        assert big.limit > small.limit

    def test_same_model_reuses_its_limiter(self):
        a = get_rate_limiter("llama-3.3-70b-versatile", 12_000)
        b = get_rate_limiter("llama-3.3-70b-versatile", 12_000)
        assert a is b
