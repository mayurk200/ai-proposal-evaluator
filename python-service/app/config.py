"""
Application settings loaded from environment variables.
"""

from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Central configuration for the Python service."""

    # Server
    PORT: int = 8000
    ENV: str = "development"
    LOG_LEVEL: str = "INFO"

    # LLM Provider
    LLM_PROVIDER: str = "groq"
    GROQ_API_KEY: str = ""
    LLM_MODEL: str = "llama-3.3-70b-versatile"
    # Structurally simple work (metadata extraction, sectioning, summarisation)
    # does not need the 70B model. Routing it to a small model cuts both cost and
    # tokens-per-minute pressure, which frees TPM budget to run the judgment
    # agents concurrently.
    LLM_MODEL_FAST: str = "llama-3.1-8b-instant"
    LLM_TEMPERATURE: float = 0.3
    LLM_MAX_TOKENS: int = 4096

    # Groq's per-minute token budgets, per model. THESE ARE ACCOUNT-SPECIFIC.
    #
    # Read yours from the response headers:
    #   curl -sD - -o /dev/null https://api.groq.com/openai/v1/chat/completions \
    #     -H "Authorization: Bearer $GROQ_API_KEY" ... | grep x-ratelimit-limit-tokens
    #
    # Groq counts (input + max_tokens) — the reservation, not the actual usage — so a
    # single request must fit inside the budget on its own, and concurrent requests
    # must fit together. The rate limiter enforces both.
    #
    # Defaults below are Groq's FREE tier. They are small, and they are the binding
    # constraint on how fast an evaluation can run: seven 70B agent calls at ~7k
    # tokens each simply cannot go faster than 12k/minute allows. Raising the account
    # tier and raising these numbers is the single highest-leverage speedup available
    # — no code changes needed.
    LLM_TPM: int = 12_000        # llama-3.3-70b-versatile
    LLM_TPM_FAST: int = 6_000    # llama-3.1-8b-instant

    # Cap on agent calls in flight at once. The rate limiter is what actually protects
    # the TPM budget; this just avoids queueing a thundering herd behind it.
    LLM_MAX_CONCURRENCY: int = 3

    # Per-call ceilings, sized so one request always fits inside LLM_TPM alongside its
    # system prompt. Agent context is capped separately in BaseAgent.
    LLM_AGENT_MAX_TOKENS: int = 2_000
    LLM_AGENT_CONTEXT_TOKENS: int = 5_000

    # Document Processing
    MAX_FILE_SIZE_MB: int = 50
    SUPPORTED_FORMATS: str = "pdf,docx,doc,pptx,ppt,txt,png,jpg,jpeg,tiff,bmp"
    CHUNK_SIZE_TOKENS: int = 2000
    CHUNK_OVERLAP_TOKENS: int = 200

    # OCR Settings
    OCR_ENABLED: bool = True
    OCR_LANGUAGE: str = "eng"
    TESSERACT_CMD: Optional[str] = None
    OCR_DPI: int = 300
    # OCR of a scanned page is CPU-bound; this bounds the thread pool used to
    # parallelise it across pages.
    OCR_MAX_WORKERS: int = 4

    # Embeddings (similarity gate)
    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    EMBEDDING_DIM: int = 384

    # Cosine similarity above which two ideas are shown to an admin as possible
    # duplicates.
    #
    # Calibrated against real proposals rather than guessed. Measured with this
    # model on AIAIC-style idea summaries:
    #
    #     same idea, completely reworded, different company  ->  0.81
    #     genuinely different ideas                          ->  0.52 - 0.65
    #
    # So the decision boundary lives in the 0.65-0.81 gap, and 0.72 sits in the
    # middle of it with margin on both sides. (An earlier value of 0.82 sat just
    # ABOVE the true-positive case and silently missed every paraphrased
    # duplicate — which is the exact thing this gate exists to catch.)
    #
    # Biased low on purpose: a false positive costs one admin a glance at two
    # proposals side by side, while a false negative funds the same idea twice.
    SIMILARITY_THRESHOLD: float = 0.72
    SIMILARITY_TOP_K: int = 5

    # Evaluation Settings
    EVALUATION_TIMEOUT_SECONDS: int = 300
    MAX_RETRIES: int = 3
    # An evaluation that fails is retryable up to this many times before it needs
    # a human to look at it.
    MAX_EVALUATION_RETRIES: int = 3

    # Storage Provider (local | s3 | minio)
    STORAGE_PROVIDER: str = "local"
    STORAGE_LOCAL_DIR: str = "./uploads"
    S3_BUCKET_NAME: str = "agrieval-uploads"
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_ENDPOINT_URL: Optional[str] = None  # Set for MinIO (e.g. http://minio:9000)
    S3_REGION: str = "us-east-1"

    # Database (PostgreSQL)
    DATABASE_URL: str = "postgresql+asyncpg://agrieval:agrieval123@localhost:5432/agrieval"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    # Background worker
    #
    # Work is queued in Postgres and drained by a pool inside this process, so
    # processing continues after the uploader's browser is gone. Set
    # WORKER_ENABLED=false to run this instance as API-only — useful when you
    # want a separate process (or container) to own the queue.
    WORKER_ENABLED: bool = True
    # Reserved for extraction/OCR/metadata: cheap, local, and the thing that
    # turns an uploaded file into something an admin can decide about.
    WORKER_INGEST_SLOTS: int = 2
    # Slots that will take anything. Kept low because the real limiter on
    # evaluation is the LLM token budget, not the number of coroutines.
    WORKER_EVALUATE_SLOTS: int = 2

    @property
    def supported_formats_list(self) -> list[str]:
        return [fmt.strip().lower() for fmt in self.SUPPORTED_FORMATS.split(",")]

    @property
    def max_file_size_bytes(self) -> int:
        return self.MAX_FILE_SIZE_MB * 1024 * 1024

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
