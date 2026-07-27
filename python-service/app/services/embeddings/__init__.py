"""Local embedding service — powers duplicate detection and section routing."""

from app.services.embeddings.embedder import (
    build_identity_text,
    cosine_similarity,
    embed_text,
    embed_texts,
    embed_texts_sync,
)

__all__ = [
    "build_identity_text",
    "cosine_similarity",
    "embed_text",
    "embed_texts",
    "embed_texts_sync",
]
