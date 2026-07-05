"""
Categorization service — Phase 2 background worker.

Given a proposal row already created with status CATEGORIZING (and the raw file
bytes), it:
  1. extracts text (reusing the document processor),
  2. stores the extracted text and records it on the row,
  3. runs the CategorizationAgent to produce the all-information JSON,
  4. persists the categories / JSON / rank on the row and marks it CATEGORIZED.

On any failure the row is marked FAILED with the error message. This runs inside a
FastAPI BackgroundTask so the trigger endpoint can return immediately.
"""

import time
from datetime import datetime, timezone
from pathlib import Path

from app.agents.categorization import CategorizationAgent
from app.models.enums import ProcessingStatus
from app.services.database.proposal_repository import get_proposal_repository
from app.services.processing.document_processor import process_document
from app.services.storage.storage_backend import get_storage_backend
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def run_categorization(
    proposal_id: str,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    run_ocr: bool = True,
) -> None:
    """Extract → store text → categorize → persist. Updates row status as it goes."""
    repo = get_proposal_repository()
    storage = get_storage_backend()
    started = time.time()

    try:
        # 1. Extract text (OCR/tables handled by the document processor).
        await repo.update_proposal(proposal_id, status=ProcessingStatus.EXTRACTING.value)
        processed = await process_document(
            file_bytes=file_bytes,
            filename=filename,
            file_type=content_type,
            run_ocr=run_ocr,
            generate_summary=False,  # no LLM summary; the agent produces the summary
        )
        extracted_text = processed.full_text or ""
        meta = processed.metadata

        # 2. Store the extracted text (best-effort) + record it on the row.
        safe_stem = Path(filename).stem[:60] or "document"
        extracted_key = f"extracted/{proposal_id}/{safe_stem}.txt"
        extracted_url = ""
        try:
            extracted_url = await storage.upload(
                extracted_text.encode("utf-8"),
                extracted_key,
                "text/plain; charset=utf-8",
            )
        except Exception as e:
            logger.warning("categorize_extracted_upload_failed", proposal_id=proposal_id, error=str(e))
            extracted_key = ""

        await repo.update_proposal(
            proposal_id,
            status=ProcessingStatus.CATEGORIZING.value,
            extracted_text=extracted_text,
            char_count=len(extracted_text),
            extracted_key=extracted_key,
            extracted_url=extracted_url,
            total_pages=meta.total_pages,
            total_words=meta.total_words,
            total_images=meta.total_images,
            total_tables=meta.total_tables,
            has_scanned_content=meta.has_scanned_content,
            detected_sections=meta.detected_sections,
            extracted_at=_utc_now_naive(),
        )

        # 3. Categorize.
        agent = CategorizationAgent()
        result = await agent.categorize(
            extracted_text,
            metadata={"filename": filename, "detected_sections": meta.detected_sections},
        )

        # 4. Persist categorization output and mark CATEGORIZED.
        await repo.update_proposal(
            proposal_id,
            status=ProcessingStatus.CATEGORIZED.value,
            categories=result.categories,                 # list -> JSON (repo encodes)
            category_json=result.model_dump_json(),
            rank=result.rank,
            agri_relevant=result.agri_relevance,
            categorized_at=_utc_now_naive(),
        )

        logger.info(
            "categorize_pipeline_done",
            proposal_id=proposal_id,
            categories=result.categories,
            rank=result.rank,
            seconds=round(time.time() - started, 2),
        )

    except Exception as e:
        logger.error("categorize_pipeline_failed", proposal_id=proposal_id, error=str(e))
        try:
            await repo.update_proposal(
                proposal_id,
                status=ProcessingStatus.FAILED.value,
                error_message=str(e),
            )
        except Exception as inner:
            logger.warning("categorize_fail_mark_failed", proposal_id=proposal_id, error=str(inner))
