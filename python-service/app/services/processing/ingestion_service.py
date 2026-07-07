"""
Ingestion service — Step 1 of the pipeline.

Flow:
  1. Hash the uploaded file (SHA-256) for dedup/search.
  2. Store the original file in object storage (MinIO/S3) under `originals/`.
  3. Extract text (and OCR/tables) from the document.
  4. Store the extracted text in object storage under `extracted/`.
  5. Build a JSON manifest describing the proposal and every storage address,
     and store it under `json/`.
  6. Persist a `proposals` row (including the extracted text column).

The manifest is the searchable index: it contains all proposal information plus
the addresses (keys + URLs) of the original file, the extracted file, and the
manifest itself.
"""

import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.models.enums import ProcessingFailureStatus, ProcessingStatus
from app.services.database.proposal_repository import get_proposal_repository
from app.services.processing.document_processor import process_document
from app.services.storage.storage_backend import get_storage_backend
from app.utils.logging import get_logger

logger = get_logger(__name__)

MANIFEST_SCHEMA_VERSION = "1.0"
TEXT_PREVIEW_CHARS = 500


class IngestionError(Exception):
    """Raised when ingestion fails; carries a failure status for the caller."""

    def __init__(self, message: str, failure_status: ProcessingFailureStatus):
        super().__init__(message)
        self.failure_status = failure_status


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _detect_format(filename: str, content_type: str) -> str:
    """Best-effort document format (extension first, then MIME)."""
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext:
        return ext
    return (content_type or "").split("/")[-1]


async def ingest_document(
    file_bytes: bytes,
    filename: str,
    content_type: str = "application/octet-stream",
    run_ocr: bool = True,
    dedup: bool = True,
) -> dict:
    """Run the full ingestion flow and return the manifest dict.

    Args:
        file_bytes: Raw bytes of the uploaded file.
        filename: Original filename.
        content_type: MIME type of the upload.
        run_ocr: Whether to OCR scanned/image content during extraction.
        dedup: If True, return the existing manifest when an identical file
            (same SHA-256) has already been ingested.

    Returns:
        The manifest dict (also persisted to storage and referenced in the DB).
    """
    start_time = time.time()
    repo = get_proposal_repository()
    storage = get_storage_backend()

    # 1. Hash for dedup / search
    file_hash = hashlib.sha256(file_bytes).hexdigest()

    if dedup:
        existing = await repo.find_by_hash(file_hash)
        if existing is not None:
            logger.info("ingest_dedup_hit", file_hash=file_hash, proposal_id=existing["id"])
            manifest = _load_manifest_from_record(existing)
            manifest["deduplicated"] = True
            return manifest

    proposal_id = str(uuid.uuid4())
    doc_format = _detect_format(filename, content_type)
    safe_stem = Path(filename).stem[:60] or "document"
    ext = Path(filename).suffix or ""

    # Stable, grouped storage keys (keys are the authoritative address).
    original_key = f"originals/{proposal_id}/{safe_stem}{ext}"
    extracted_key = f"extracted/{proposal_id}/{safe_stem}.txt"
    manifest_key = f"json/{proposal_id}.json"

    # 2. Store the original file.
    try:
        original_url = await storage.upload(file_bytes, original_key, content_type)
    except Exception as e:
        logger.error("ingest_original_upload_failed", error=str(e))
        raise IngestionError(str(e), ProcessingFailureStatus.STORAGE_FAILED)

    # 3. Extract text (OCR/tables handled by the document processor).
    try:
        processed = await process_document(
            file_bytes=file_bytes,
            filename=filename,
            file_type=content_type,
            run_ocr=run_ocr,
            generate_summary=False,  # ingestion is extraction-only; no LLM
        )
    except Exception as e:
        logger.error("ingest_extraction_failed", error=str(e))
        # Record a failed proposal so the original file remains traceable.
        await _save_failed_proposal(
            repo, proposal_id, filename, doc_format, content_type,
            len(file_bytes), file_hash, original_key, original_url,
            ProcessingFailureStatus.EXTRACTION_FAILED, str(e),
        )
        raise IngestionError(str(e), ProcessingFailureStatus.EXTRACTION_FAILED)

    extracted_text = processed.full_text or ""
    meta = processed.metadata
    extracted_at = _utc_now_naive()

    # 4. Store the extracted text.
    extracted_url = ""
    try:
        extracted_url = await storage.upload(
            extracted_text.encode("utf-8"), extracted_key, "text/plain; charset=utf-8"
        )
    except Exception as e:
        logger.warning("ingest_extracted_upload_failed", error=str(e))

    # Pre-generate the manifest URL so it can reference itself.
    try:
        manifest_url = await storage.get_url(manifest_key)
    except Exception:
        manifest_url = ""

    # 5. Build the manifest (all info + all addresses).
    manifest = {
        "proposal_id": proposal_id,
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "created_at": extracted_at.isoformat(),
        "file": {
            "filename": filename,
            "format": doc_format,
            "content_type": content_type,
            "size_bytes": len(file_bytes),
            "sha256": file_hash,
        },
        "extraction": {
            "status": ProcessingStatus.TEXT_EXTRACTED.value,
            "extractor": "document_processor",
            "extracted_at": extracted_at.isoformat(),
            "char_count": len(extracted_text),
            "total_pages": meta.total_pages,
            "total_words": meta.total_words,
            "total_images": meta.total_images,
            "total_tables": meta.total_tables,
            "has_scanned_content": meta.has_scanned_content,
            "detected_sections": meta.detected_sections,
            "text_preview": extracted_text[:TEXT_PREVIEW_CHARS],
        },
        "storage": {
            "provider": settings.STORAGE_PROVIDER,
            "bucket": settings.S3_BUCKET_NAME,
            "original": {"key": original_key, "url": original_url},
            "extracted": {"key": extracted_key, "url": extracted_url},
            "manifest": {"key": manifest_key, "url": manifest_url},
        },
        "processing_time_seconds": round(time.time() - start_time, 3),
    }

    # Store the manifest itself.
    try:
        stored_manifest_url = await storage.upload(
            json.dumps(manifest, indent=2).encode("utf-8"),
            manifest_key,
            "application/json",
        )
        if stored_manifest_url:
            manifest["storage"]["manifest"]["url"] = stored_manifest_url
            manifest_url = stored_manifest_url
    except Exception as e:
        logger.warning("ingest_manifest_upload_failed", error=str(e))

    # 6. Persist the proposal row (extracted text in its own column).
    try:
        await repo.create_proposal(
            proposal_id=proposal_id,
            filename=filename,
            document_format=doc_format,
            file_content_type=content_type,
            file_size_bytes=len(file_bytes),
            file_hash=file_hash,
            original_key=original_key,
            original_url=original_url,
            extracted_key=extracted_key,
            extracted_url=extracted_url,
            manifest_key=manifest_key,
            manifest_url=manifest_url,
            extracted_text=extracted_text,
            char_count=len(extracted_text),
            total_pages=meta.total_pages,
            total_words=meta.total_words,
            total_images=meta.total_images,
            total_tables=meta.total_tables,
            has_scanned_content=meta.has_scanned_content,
            detected_sections=meta.detected_sections,
            status=ProcessingStatus.TEXT_EXTRACTED.value,
            extracted_at=extracted_at,
        )
    except Exception as e:
        logger.error("ingest_db_save_failed", error=str(e))
        raise IngestionError(str(e), ProcessingFailureStatus.DATABASE_FAILED)

    logger.info(
        "ingest_completed",
        proposal_id=proposal_id,
        filename=filename,
        words=meta.total_words,
        seconds=manifest["processing_time_seconds"],
    )
    return manifest


def _load_manifest_from_record(record: dict) -> dict:
    """Reconstruct a manifest-shaped dict from a stored proposal record."""
    return {
        "proposal_id": record["id"],
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "created_at": record.get("created_at"),
        "file": {
            "filename": record.get("filename"),
            "format": record.get("document_format"),
            "content_type": record.get("file_content_type"),
            "size_bytes": record.get("file_size_bytes"),
            "sha256": record.get("file_hash"),
        },
        "extraction": {
            "status": record.get("status"),
            "char_count": record.get("char_count"),
            "total_pages": record.get("total_pages"),
            "total_words": record.get("total_words"),
            "total_images": record.get("total_images"),
            "total_tables": record.get("total_tables"),
            "has_scanned_content": record.get("has_scanned_content"),
            "detected_sections": record.get("detected_sections"),
            "text_preview": (record.get("extracted_text") or "")[:TEXT_PREVIEW_CHARS],
        },
        "storage": {
            "provider": settings.STORAGE_PROVIDER,
            "bucket": settings.S3_BUCKET_NAME,
            "original": {"key": record.get("original_key"), "url": record.get("original_url")},
            "extracted": {"key": record.get("extracted_key"), "url": record.get("extracted_url")},
            "manifest": {"key": record.get("manifest_key"), "url": record.get("manifest_url")},
        },
    }


async def _save_failed_proposal(
    repo,
    proposal_id: str,
    filename: str,
    doc_format: str,
    content_type: str,
    size_bytes: int,
    file_hash: str,
    original_key: str,
    original_url: str,
    failure_status: ProcessingFailureStatus,
    error_message: str,
) -> None:
    """Best-effort persistence of a failed ingestion for traceability."""
    try:
        await repo.create_proposal(
            proposal_id=proposal_id,
            filename=filename,
            document_format=doc_format,
            file_content_type=content_type,
            file_size_bytes=size_bytes,
            file_hash=file_hash,
            original_key=original_key,
            original_url=original_url,
            status=ProcessingStatus.FAILED.value,
            error_message=f"{failure_status.value}: {error_message}",
        )
    except Exception as e:
        logger.warning("failed_proposal_save_failed", error=str(e))
