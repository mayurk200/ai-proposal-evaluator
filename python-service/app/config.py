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
    LLM_TEMPERATURE: float = 0.3
    LLM_MAX_TOKENS: int = 4096

    # Document Processing
    MAX_FILE_SIZE_MB: int = 50
    SUPPORTED_FORMATS: str = "pdf,docx,doc,pptx,ppt,txt,png,jpg,jpeg,tiff,bmp"
    CHUNK_SIZE_TOKENS: int = 2000
    CHUNK_OVERLAP_TOKENS: int = 200

    # OCR Settings
    OCR_ENABLED: bool = True
    OCR_LANGUAGE: str = "eng"
    TESSERACT_CMD: Optional[str] = None

    # Evaluation Settings
    EVALUATION_TIMEOUT_SECONDS: int = 300
    MAX_RETRIES: int = 3

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

    @property
    def supported_formats_list(self) -> list[str]:
        return [fmt.strip().lower() for fmt in self.SUPPORTED_FORMATS.split(",")]

    @property
    def max_file_size_bytes(self) -> int:
        return self.MAX_FILE_SIZE_MB * 1024 * 1024

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
