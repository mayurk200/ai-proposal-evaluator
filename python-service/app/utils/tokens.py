"""
Token counting.

The old `estimate_token_count` was `len(text) // 4`. That number fed chunk sizing,
summary batching, the TPM budget and the agent payload caps — so when it was
wrong, it was wrong in the two directions that both hurt: it under-counted dense
tabular/financial text (blowing through Groq's rate limit and eating 429s) and
over-counted prose (under-filling chunks and paying for more calls than needed).

Llama's tokenizer is not public, but `cl100k_base` tracks it far more closely than
a fixed chars-per-token ratio, and being approximately right beats being
confidently wrong. Encoding is cached because the same chunk text is measured
repeatedly across routing, packing and budgeting.
"""

from __future__ import annotations

import functools
import threading

import tiktoken

from app.utils.logging import get_logger

logger = get_logger(__name__)

_ENCODING_NAME = "cl100k_base"
_encoding = None
_lock = threading.Lock()


def _get_encoding():
    """Load the encoder once. It is thread-safe to use, but not to construct twice."""
    global _encoding
    if _encoding is None:
        with _lock:
            if _encoding is None:
                _encoding = tiktoken.get_encoding(_ENCODING_NAME)
    return _encoding


@functools.lru_cache(maxsize=2048)
def _count_cached(text: str) -> int:
    return len(_get_encoding().encode(text, disallowed_special=()))


def count_tokens(text: str) -> int:
    """Exact token count for `text` under cl100k_base."""
    if not text:
        return 0
    try:
        # lru_cache needs hashable keys and bounded size; very long strings are
        # both expensive to hash and unlikely to repeat, so bypass the cache.
        if len(text) > 20_000:
            return len(_get_encoding().encode(text, disallowed_special=()))
        return _count_cached(text)
    except Exception as exc:  # pragma: no cover - tiktoken should not fail
        logger.warning("token_count_failed", error=str(exc))
        return max(1, len(text) // 4)


def truncate_to_tokens(text: str, max_tokens: int) -> str:
    """
    Cut `text` down to at most `max_tokens`.

    Truncating on a token boundary rather than a character count is what keeps an
    agent payload just under the model's limit instead of just over it.
    """
    if not text:
        return ""

    encoding = _get_encoding()
    tokens = encoding.encode(text, disallowed_special=())
    if len(tokens) <= max_tokens:
        return text

    return encoding.decode(tokens[:max_tokens])


def fits_budget(text: str, max_tokens: int) -> bool:
    return count_tokens(text) <= max_tokens
