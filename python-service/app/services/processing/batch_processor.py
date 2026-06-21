"""
Batch document processor — evaluates multiple files sequentially
with rate limiting to respect Groq TPM limits.
"""

import asyncio
import uuid
import time
from typing import Optional

from app.services.processing.document_processor import process_document
from app.services.storage.storage_backend import StorageBackend, get_storage_backend
from app.services.database.repository import EvaluationRepository, get_repository, utc_now_naive
from app.agents.orchestrator import AgentOrchestrator
from app.utils.logging import get_logger

logger = get_logger(__name__)


async def process_batch(
    files: list[dict],
    batch_id: Optional[str] = None,
    storage: Optional[StorageBackend] = None,
    repo: Optional[EvaluationRepository] = None,
) -> dict:
    """
    Process and evaluate multiple files in a batch.

    Args:
        files: List of dicts with keys: bytes, filename, content_type
        batch_id: Optional batch identifier (generated if not provided)
        storage: Storage backend (defaults to singleton)
        repo: Database repository (defaults to singleton)

    Returns:
        Dict with batch_id, per-file results, and summary counts.
    """
    batch_id = batch_id or str(uuid.uuid4())
    storage = storage or get_storage_backend()
    repo = repo or get_repository()

    results = []
    completed = 0
    failed = 0

    logger.info("batch_started", batch_id=batch_id, total_files=len(files))

    for i, file_info in enumerate(files):
        file_bytes = file_info["bytes"]
        filename = file_info["filename"]
        content_type = file_info.get("content_type", "application/octet-stream")
        eval_id = ""

        logger.info("batch_file_processing", batch_id=batch_id, file_index=i + 1, filename=filename)

        # Create a pending record in the database when persistence is available.
        try:
            eval_id = await repo.save_evaluation(
                filename=filename,
                file_size_bytes=len(file_bytes),
                file_content_type=content_type,
                status="processing",
                batch_id=batch_id,
            )
        except Exception as e:
            logger.warning("batch_persist_pending_failed", batch_id=batch_id, filename=filename, error=str(e))

        try:
            start_time = time.time()

            # Upload file to storage
            storage_key = StorageBackend.generate_key(filename)
            file_url = await storage.upload(file_bytes, storage_key, content_type)

            # Process document
            processed = await process_document(
                file_bytes=file_bytes,
                filename=filename,
                file_type=content_type,
                run_ocr=True,
                generate_summary=True,
            )

            if not processed.full_text.strip() or len(processed.full_text.split()) < 20:
                raise ValueError(f"Insufficient text extracted from {filename}")

            # Run evaluation
            orchestrator = AgentOrchestrator()
            eval_response = await orchestrator.evaluate(document=processed)

            total_time = time.time() - start_time
            eval_response.processing_time_seconds = round(total_time, 2)

            # Persist the report
            if eval_id:
                try:
                    await repo.update_evaluation(
                        eval_id,
                        file_storage_key=storage_key,
                        file_storage_url=file_url,
                        overall_score=eval_response.evaluation.overall_score,
                        recommendation=eval_response.evaluation.recommendation,
                        evaluation_report=eval_response.model_dump(mode="json"),
                        document_metadata=processed.metadata.model_dump(mode="json"),
                        status="completed",
                        completed_at=utc_now_naive(),
                    )
                except Exception as e:
                    logger.warning("batch_persist_completed_failed", batch_id=batch_id, filename=filename, error=str(e))

            results.append({
                "evaluation_id": eval_id or None,
                "filename": filename,
                "status": "completed",
                "overall_score": eval_response.evaluation.overall_score,
                "recommendation": eval_response.evaluation.recommendation,
                "file_url": file_url,
                "processing_time_seconds": round(total_time, 2),
            })
            completed += 1

        except Exception as e:
            logger.error("batch_file_failed", batch_id=batch_id, filename=filename, error=str(e))

            if eval_id:
                try:
                    await repo.update_evaluation(
                        eval_id,
                        status="failed",
                        error_message=str(e),
                    )
                except Exception as persist_error:
                    logger.warning("batch_persist_failed_status_failed", batch_id=batch_id, filename=filename, error=str(persist_error))

            results.append({
                "evaluation_id": eval_id or None,
                "filename": filename,
                "status": "failed",
                "error": str(e),
            })
            failed += 1

        # Brief delay between files to respect rate limits
        if i < len(files) - 1:
            await asyncio.sleep(2)

    logger.info(
        "batch_completed",
        batch_id=batch_id,
        completed=completed,
        failed=failed,
    )

    return {
        "batch_id": batch_id,
        "total_files": len(files),
        "completed": completed,
        "failed": failed,
        "results": results,
    }
