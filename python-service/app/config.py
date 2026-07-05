"""
Application settings loaded from environment variables.

Settings may additionally be overridden at runtime (e.g. from the Node backend's
Settings page) via `apply_settings_overrides`. Overrides are persisted to a JSON
file and re-applied on startup so they survive restarts.
"""

import json
import logging
from pathlib import Path
from pydantic_settings import BaseSettings
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Keys that may be changed at runtime. Anything not listed is ignored, so the
# override channel can never touch, say, the server port from a client request.
RUNTIME_OVERRIDABLE_KEYS: set[str] = {
    "LLM_PROVIDER",
    "GROQ_API_KEY",
    "LLM_MODEL",
    "LLM_TEMPERATURE",
    "LLM_MAX_TOKENS",
    "MAX_FILE_SIZE_MB",
    "SUPPORTED_FORMATS",
    "CHUNK_SIZE_TOKENS",
    "CHUNK_OVERLAP_TOKENS",
    "OCR_ENABLED",
    "OCR_LANGUAGE",
    "TESSERACT_CMD",
    "EVALUATION_TIMEOUT_SECONDS",
    "MAX_RETRIES",
    "STORAGE_PROVIDER",
    "STORAGE_LOCAL_DIR",
    "S3_BUCKET_NAME",
    "S3_REGION",
    "S3_ENDPOINT_URL",
    "DATABASE_URL",
    "LOG_LEVEL",
}

# Secret keys are never returned to callers of get_editable_settings().
SECRET_KEYS: set[str] = {"GROQ_API_KEY", "DATABASE_URL"}

# Curated agriculture category taxonomy used by the CategorizationAgent.
# This is the *preferred* vocabulary the agent tags proposals with. The agent may
# introduce a new tag when nothing here fits — but every category must remain
# strictly agriculture-related (see the agent's system prompt). Non-agri tags are
# not permitted.
AGRI_CATEGORY_TAXONOMY: list[str] = [
    "precision-agriculture",
    "iot-and-sensors",
    "remote-sensing-and-gis",
    "ai-and-data-analytics",
    "farm-automation-and-robotics",
    "drones-and-aerial-imaging",
    "soil-health-and-nutrition",
    "crop-health-and-protection",
    "irrigation-and-water-management",
    "weather-and-climate-resilience",
    "livestock-and-dairy",
    "aquaculture-and-fisheries",
    "horticulture-and-plantation",
    "seeds-and-genetics",
    "post-harvest-and-cold-chain",
    "supply-chain-and-logistics",
    "market-linkage-and-e-commerce",
    "agri-fintech-and-credit",
    "agri-insurance",
    "farmer-advisory-and-extension",
    "traceability-and-food-safety",
    "sustainability-and-regenerative-ag",
    "carbon-and-agroforestry",
    "biotech-and-inputs",
    "farm-management-software",
]

_SERVICE_DIR = Path(__file__).resolve().parent.parent  # python-service/
_REPO_ROOT = _SERVICE_DIR.parent

_OVERRIDES_FILE = _SERVICE_DIR / "runtime_settings.json"


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

    # Database (PostgreSQL). No default on purpose: the URL (and its password)
    # must come from the environment / .env files. Preflight fails startup with
    # a clear message when it is missing.
    DATABASE_URL: str = ""

    @property
    def supported_formats_list(self) -> list[str]:
        return [fmt.strip().lower() for fmt in self.SUPPORTED_FORMATS.split(",")]

    @property
    def max_file_size_bytes(self) -> int:
        return self.MAX_FILE_SIZE_MB * 1024 * 1024

    # Env-file precedence (lowest → highest): repo-root .env (shared values,
    # single source of truth) → python-service/.env (service-specific
    # overrides) → real OS environment variables. Absolute paths so startup
    # works regardless of the current working directory.
    model_config = {
        "env_file": (str(_REPO_ROOT / ".env"), str(_SERVICE_DIR / ".env")),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()


def _coerce_to_field_type(key: str, value: Any) -> Any:
    """Coerce an incoming override value to the type of the existing setting."""
    current = getattr(settings, key, None)
    if isinstance(current, bool):
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)
    if isinstance(current, int) and not isinstance(current, bool):
        return int(value)
    if isinstance(current, float):
        return float(value)
    # Optional[str] fields default to None; treat blank as "unset".
    if value in (None, ""):
        return None if current is None else value
    return value


def apply_settings_overrides(data: dict[str, Any], *, persist: bool = True) -> dict[str, Any]:
    """
    Apply a dict of overrides onto the live `settings` object.

    Only whitelisted keys are honoured; unknown or non-overridable keys are
    ignored. When `persist` is True the merged overrides are written to disk so
    they are re-applied on the next startup. Returns the current editable
    settings (secrets masked).
    """
    applied: dict[str, Any] = {}
    for key, value in (data or {}).items():
        if key not in RUNTIME_OVERRIDABLE_KEYS:
            continue
        try:
            coerced = _coerce_to_field_type(key, value)
        except (TypeError, ValueError):
            logger.warning("settings_override_coerce_failed key=%s value=%r", key, value)
            continue
        setattr(settings, key, coerced)
        applied[key] = coerced

    if persist and applied:
        _persist_overrides(applied)

    return get_editable_settings()


def _persist_overrides(new_overrides: dict[str, Any]) -> None:
    """Merge `new_overrides` into the persisted overrides file."""
    try:
        existing: dict[str, Any] = {}
        if _OVERRIDES_FILE.exists():
            existing = json.loads(_OVERRIDES_FILE.read_text(encoding="utf-8"))
        existing.update(new_overrides)
        _OVERRIDES_FILE.write_text(json.dumps(existing, indent=2, default=str), encoding="utf-8")
    except Exception as exc:  # persistence is best-effort
        logger.warning("settings_override_persist_failed error=%s", exc)


def load_persisted_overrides() -> None:
    """Re-apply overrides saved from a previous run. Call once on startup."""
    try:
        if _OVERRIDES_FILE.exists():
            data = json.loads(_OVERRIDES_FILE.read_text(encoding="utf-8"))
            apply_settings_overrides(data, persist=False)
            logger.info("settings_overrides_loaded count=%d", len(data))
    except Exception as exc:
        logger.warning("settings_override_load_failed error=%s", exc)


def get_editable_settings() -> dict[str, Any]:
    """Return the current runtime-editable settings with secrets masked."""
    result: dict[str, Any] = {}
    for key in RUNTIME_OVERRIDABLE_KEYS:
        value = getattr(settings, key, None)
        if key in SECRET_KEYS:
            result[key] = bool(value)  # True when configured, never the value
        else:
            result[key] = value
    return result


# Apply any persisted overrides at import time.
load_persisted_overrides()
