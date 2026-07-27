"""
Local embeddings.

Used for two things:

1. The duplicate-idea gate — embedding an idea's identity (title + problem +
   solution) so a reworded resubmission of the same idea still lands next to the
   original in vector space. A hash or a fuzzy string match only catches
   copy-paste; the client explicitly wants "similar", not "identical".

2. Semantic section routing — deciding which part of a document is the financial
   section, the team section, and so on, so each agent receives only the sections
   it is meant to judge. Keyword lists cannot do this: a paragraph about
   affordability that never uses the word "pricing" is still a pricing paragraph.

fastembed runs the model under ONNX on CPU with no torch dependency. Embedding is
local, so it costs no tokens and no API calls — which is what makes it affordable
to embed every section of every document.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Optional

import numpy as np

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger(__name__)

_model = None
_lock = threading.Lock()


def _get_model():
    """
    Load the embedding model once, lazily.

    First call downloads the model (~130MB) and takes a few seconds; every call
    after is milliseconds. Doing it lazily keeps service startup fast and means a
    deployment that never ingests a document never pays for it.
    """
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from fastembed import TextEmbedding

                logger.info("loading_embedding_model", model=settings.EMBEDDING_MODEL)
                _model = TextEmbedding(model_name=settings.EMBEDDING_MODEL)
                logger.info("embedding_model_ready")
    return _model


def embed_texts_sync(texts: list[str]) -> list[list[float]]:
    """Embed a batch. CPU-bound — callers should push this to a thread."""
    if not texts:
        return []

    model = _get_model()
    vectors = list(model.embed(texts))

    # Normalize to unit length so cosine similarity is a plain dot product, and so
    # pgvector's cosine distance behaves predictably.
    normalized: list[list[float]] = []
    for vector in vectors:
        array = np.asarray(vector, dtype=np.float32)
        norm = float(np.linalg.norm(array))
        if norm > 0:
            array = array / norm
        normalized.append(array.tolist())

    return normalized


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Async wrapper — keeps the event loop free while the model runs."""
    if not texts:
        return []
    return await asyncio.to_thread(embed_texts_sync, texts)


async def embed_text(text: str) -> list[float]:
    """Embed a single string."""
    vectors = await embed_texts([text])
    return vectors[0] if vectors else []


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors. Both are expected to be unit-length."""
    if not a or not b:
        return 0.0
    va, vb = np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0.0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def build_identity_text(
    *,
    title: Optional[str] = None,
    company: Optional[str] = None,
    problem: Optional[str] = None,
    solution: Optional[str] = None,
    theme: Optional[str] = None,
    fallback: str = "",
) -> str:
    """
    Compose the text that *represents an idea* for duplicate detection.

    Deliberately built from the idea's substance — the problem it attacks and the
    solution it proposes — and NOT from the whole document. Two proposals from the
    same accelerator share boilerplate, headers, compliance language and formatting;
    embedding the full text would score them as similar because their paperwork
    matches, which is a false positive that wastes an admin's attention.

    The company name is deliberately excluded: the same company submitting a
    genuinely different idea must NOT look like a duplicate, and two different
    companies converging on the same idea very much must.
    """
    parts = [p.strip() for p in (title, theme, problem, solution) if p and p.strip()]
    if parts:
        return "\n".join(parts)

    # Nothing structured was extracted — fall back to the head of the document,
    # which at least captures the cover page and abstract.
    return fallback[:2000]


def reset_model() -> None:
    """Used by tests."""
    global _model
    _model = None
