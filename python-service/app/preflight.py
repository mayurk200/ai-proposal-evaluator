"""
Startup preflight checks.

Run before the service accepts traffic: verifies configuration, PostgreSQL
connectivity, schema initialization (create_all + idempotent column
migrations), MinIO reachability, GROQ configuration, OCR availability, and
writable directories. Prints a PASS/FAIL/WARN report and raises
`PreflightError` on any FAIL so startup aborts instead of limping along and
returning 500s later.
"""

import asyncio
import json
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import _OVERRIDES_FILE, settings
from app.utils.logging import get_logger

logger = get_logger(__name__)

# How long we wait for PostgreSQL to come up (tolerates `docker compose up`
# ordering: the container may be healthy a few seconds after this service
# starts). Overridable without code changes.
DB_RETRIES = int(os.environ.get("PREFLIGHT_DB_RETRIES", "10"))
DB_RETRY_DELAY_SECONDS = float(os.environ.get("PREFLIGHT_DB_RETRY_DELAY", "2"))


class PreflightError(RuntimeError):
    """Raised when one or more preflight checks FAIL."""


@dataclass
class CheckResult:
    name: str
    status: str  # PASS | FAIL | WARN
    detail: str


def _mask_dsn(url: str) -> str:
    """Hide the password portion of a DSN for logs."""
    return re.sub(r"(://[^:/@]+):[^@]*@", r"\1:***@", url)


def _check_config() -> list[CheckResult]:
    results: list[CheckResult] = []

    if settings.DATABASE_URL:
        results.append(CheckResult("config: DATABASE_URL", "PASS", _mask_dsn(settings.DATABASE_URL)))
    else:
        results.append(
            CheckResult(
                "config: DATABASE_URL",
                "FAIL",
                "not set - add DATABASE_URL to the root .env (see .env.example)",
            )
        )

    if settings.LLM_PROVIDER == "groq":
        if not settings.GROQ_API_KEY:
            results.append(
                CheckResult(
                    "config: GROQ_API_KEY",
                    "FAIL",
                    "not set - add GROQ_API_KEY to the root .env (https://console.groq.com/keys)",
                )
            )
        elif not settings.GROQ_API_KEY.startswith("gsk_"):
            results.append(
                CheckResult("config: GROQ_API_KEY", "WARN", "set but does not look like a Groq key (gsk_...)")
            )
        else:
            results.append(CheckResult("config: GROQ_API_KEY", "PASS", "configured"))

    if settings.STORAGE_PROVIDER in ("s3", "minio"):
        missing = [
            name
            for name, value in (
                ("S3_ACCESS_KEY", settings.S3_ACCESS_KEY),
                ("S3_SECRET_KEY", settings.S3_SECRET_KEY),
                ("S3_ENDPOINT_URL", settings.S3_ENDPOINT_URL),
            )
            if not value
        ]
        if missing:
            results.append(
                CheckResult(
                    "config: S3/MinIO",
                    "FAIL",
                    f"STORAGE_PROVIDER={settings.STORAGE_PROVIDER} but missing: {', '.join(missing)} (root .env)",
                )
            )
        else:
            results.append(CheckResult("config: S3/MinIO", "PASS", f"provider={settings.STORAGE_PROVIDER}"))

    # runtime_settings.json can silently override .env values - surface that.
    if _OVERRIDES_FILE.exists():
        try:
            overrides = json.loads(_OVERRIDES_FILE.read_text(encoding="utf-8"))
        except Exception:
            overrides = {}
        if overrides:
            secretish = "DATABASE_URL" in overrides
            results.append(
                CheckResult(
                    "config: runtime overrides",
                    "WARN",
                    f"{_OVERRIDES_FILE.name} overrides {sorted(overrides)}"
                    + (" - DATABASE_URL from .env is NOT in effect!" if secretish else ""),
                )
            )
    return results


async def _check_database() -> list[CheckResult]:
    """Connect (with retries), initialize schema, and verify tables/columns."""
    if not settings.DATABASE_URL:
        return [CheckResult("postgresql", "FAIL", "skipped - DATABASE_URL not set")]

    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    last_error: Exception | None = None
    connected_attempt = 0
    try:
        for attempt in range(1, DB_RETRIES + 1):
            try:
                async with engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))
                connected_attempt = attempt
                break
            except Exception as e:  # noqa: BLE001 - report any connection failure
                last_error = e
                if attempt < DB_RETRIES:
                    await asyncio.sleep(DB_RETRY_DELAY_SECONDS)
        else:
            hint = ""
            if "password authentication failed" in str(last_error):
                hint = (
                    " - the password in DATABASE_URL does not match the database. "
                    "See docs/setup.md 'Password reset' (scripts\\dev.ps1 self-heals this)."
                )
            return [
                CheckResult(
                    "postgresql",
                    "FAIL",
                    f"cannot connect after {DB_RETRIES} attempts: {last_error}{hint}",
                )
            ]

        results = [
            CheckResult("postgresql", "PASS", f"{_mask_dsn(settings.DATABASE_URL)} (attempt {connected_attempt})")
        ]

        # Schema init: create_all for both repos + idempotent ALTER TABLE
        # column migrations owned by the proposal repository.
        try:
            from app.services.database.proposal_repository import get_proposal_repository
            from app.services.database.repository import get_repository

            await get_repository().init_tables()
            await get_proposal_repository().init_tables()
        except Exception as e:  # noqa: BLE001
            results.append(CheckResult("schema: init", "FAIL", f"table initialization failed: {e}"))
            return results
        results.append(CheckResult("schema: init", "PASS", "create_all + column migrations applied"))

        # Verify every model table and column actually exists in the database.
        async with engine.connect() as conn:
            if conn.dialect.name == "postgresql":
                from app.services.database.models import Base

                problems: list[str] = []
                for table in Base.metadata.tables.values():
                    rows = await conn.execute(
                        text(
                            "SELECT column_name FROM information_schema.columns "
                            "WHERE table_schema = current_schema() AND table_name = :t"
                        ),
                        {"t": table.name},
                    )
                    existing = {r[0] for r in rows}
                    if not existing:
                        problems.append(f"table '{table.name}' missing")
                        continue
                    missing_cols = [c.name for c in table.columns if c.name not in existing]
                    if missing_cols:
                        problems.append(f"table '{table.name}' missing columns: {', '.join(missing_cols)}")
                if problems:
                    results.append(CheckResult("schema: verify", "FAIL", "; ".join(problems)))
                else:
                    tables = ", ".join(sorted(t.name for t in Base.metadata.tables.values()))
                    results.append(CheckResult("schema: verify", "PASS", f"tables verified: {tables}"))
        return results
    finally:
        await engine.dispose()


def _check_minio() -> list[CheckResult]:
    if settings.STORAGE_PROVIDER not in ("s3", "minio"):
        return [CheckResult("storage", "PASS", f"provider={settings.STORAGE_PROVIDER} (no MinIO check needed)")]
    try:
        import boto3
        from botocore.config import Config
        from botocore.exceptions import ClientError

        client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
            config=Config(connect_timeout=3, read_timeout=5, retries={"max_attempts": 1}),
        )
        bucket = settings.S3_BUCKET_NAME
        try:
            client.head_bucket(Bucket=bucket)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchBucket"):
                client.create_bucket(Bucket=bucket)
            else:
                raise
        return [CheckResult("minio", "PASS", f"bucket '{bucket}' at {settings.S3_ENDPOINT_URL}")]
    except Exception as e:  # noqa: BLE001
        return [
            CheckResult(
                "minio",
                "FAIL",
                f"cannot reach MinIO at {settings.S3_ENDPOINT_URL}: {e} "
                "(is the agrieval-minio container running? check credentials in root .env)",
            )
        ]


def _check_ocr() -> list[CheckResult]:
    """OCR is optional (image-only documents degrade) - WARN, never FAIL."""
    if not settings.OCR_ENABLED:
        return [CheckResult("ocr", "PASS", "disabled by config")]
    try:
        import pytesseract

        version = pytesseract.get_tesseract_version()
        return [CheckResult("ocr", "PASS", f"tesseract {version}")]
    except Exception:
        try:
            import easyocr  # noqa: F401

            return [CheckResult("ocr", "WARN", "tesseract not found; easyocr fallback available")]
        except Exception:
            return [
                CheckResult(
                    "ocr",
                    "WARN",
                    "no OCR engine available - image files cannot be processed "
                    "(install Tesseract or set TESSERACT_CMD; see docs/setup.md)",
                )
            ]


def _check_writable_dirs() -> list[CheckResult]:
    targets = {
        "uploads dir": Path(settings.STORAGE_LOCAL_DIR),
        "runtime settings dir": _OVERRIDES_FILE.parent,
    }
    problems = []
    for label, directory in targets.items():
        try:
            directory.mkdir(parents=True, exist_ok=True)
            probe = directory / f".preflight-{uuid.uuid4().hex}.tmp"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
        except Exception as e:  # noqa: BLE001
            problems.append(f"{label} ({directory}): {e}")
    if problems:
        return [CheckResult("writable dirs", "FAIL", "; ".join(problems))]
    return [CheckResult("writable dirs", "PASS", ", ".join(str(d) for d in targets.values()))]


def format_report(results: list[CheckResult]) -> str:
    width = max(len(r.name) for r in results)
    lines = ["", "=" * 72, " PREFLIGHT REPORT".ljust(72, " "), "=" * 72]
    for r in results:
        lines.append(f" [{r.status:<4}] {r.name.ljust(width)}  {r.detail}")
    failed = [r for r in results if r.status == "FAIL"]
    warned = [r for r in results if r.status == "WARN"]
    lines.append("-" * 72)
    if failed:
        lines.append(f" RESULT: FAIL - {len(failed)} check(s) failed; service will NOT start.")
    elif warned:
        lines.append(f" RESULT: PASS with {len(warned)} warning(s).")
    else:
        lines.append(" RESULT: PASS - all checks green.")
    lines.append("=" * 72)
    return "\n".join(lines)


async def run_preflight() -> list[CheckResult]:
    results: list[CheckResult] = []
    results.extend(_check_config())
    results.extend(await _check_database())
    results.extend(_check_minio())
    results.extend(_check_ocr())
    results.extend(_check_writable_dirs())
    return results


async def assert_preflight() -> None:
    """Run all checks, print the report, and raise on any FAIL."""
    results = await run_preflight()
    report = format_report(results)
    print(report, flush=True)
    failed = [r for r in results if r.status == "FAIL"]
    if failed:
        logger.error("preflight_failed", failed=[r.name for r in failed])
        raise PreflightError(
            "Preflight failed: " + "; ".join(f"{r.name}: {r.detail}" for r in failed)
        )
    logger.info("preflight_passed", warnings=[r.name for r in results if r.status == "WARN"])
