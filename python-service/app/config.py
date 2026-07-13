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
    # Cap on parameter agents in flight at once. They are independent of each
    # other, so this is purely a rate-limit guard, not a correctness one.
    LLM_MAX_CONCURRENCY: int = 3

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
    # Cosine similarity above which two ideas are surfaced to an admin as
    # possible duplicates. Tuned conservatively — a false positive costs one
    # admin glance; a false negative funds the same idea twice.
    SIMILARITY_THRESHOLD: float = 0.82
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

    @property
    def supported_formats_list(self) -> list[str]:
        return [fmt.strip().lower() for fmt in self.SUPPORTED_FORMATS.split(",")]

    @property
    def max_file_size_bytes(self) -> int:
        return self.MAX_FILE_SIZE_MB * 1024 * 1024

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
