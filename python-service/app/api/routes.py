"""
FastAPI API routes for document processing, evaluation, storage, and report comparison.
"""

import hashlib
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile, Form, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.config import settings, apply_settings_overrides, get_editable_settings
from app.models.schemas import (
    BatchEvaluationResponse,
    CategorizeResponse,
    CompareRequest,
    CompareResponse,
    EvaluateChunksRequest,
    EvaluationResponse,
    HealthResponse,
    IngestResponse,
    ProcessDocumentResponse,
    ProcessedDocument,
    ProposalResponse,
    ReportListResponse,
    SupportedFormatsResponse,
)
from app.models.enums import ProcessingStatus
from app.services.processing.document_processor import process_document
from app.services.processing.batch_processor import process_batch
from app.services.processing.ingestion_service import IngestionError, ingest_document
from app.services.processing.categorization_service import run_categorization
from app.services.storage.storage_backend import StorageBackend, get_storage_backend
from app.services.database.repository import get_repository
from app.services.database.proposal_repository import get_proposal_repository
from app.agents.orchestrator import AgentOrchestrator
from app.api.dependencies import verify_llm_connection
from app.utils.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1")


# =============================================================================
# Health & Info
# =============================================================================


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint.

    Returns 200 when the hard dependencies (database, storage) are up — OCR
    and LLM problems only degrade the status string. Returns 503 with the same
    payload when a hard dependency is down, so callers and orchestration can
    react instead of treating a broken service as healthy.
    """
    services = {
        "llm": "connected" if verify_llm_connection() else "disconnected",
    }

    # Check Tesseract
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        services["tesseract_ocr"] = "available"
    except Exception:
        services["tesseract_ocr"] = "unavailable"

    # Check database (hard dependency)
    try:
        repo = get_repository()
        await repo.list_evaluations(page=1, limit=1)
        services["database"] = "connected"
    except Exception as e:
        services["database"] = f"disconnected: {e}"

    # Check storage (hard dependency) — constructing the backend validates config.
    try:
        get_storage_backend()
        services["storage"] = f"{settings.STORAGE_PROVIDER} (ok)"
    except Exception as e:
        services["storage"] = f"unavailable: {e}"

    db_ok = services["database"] == "connected"
    storage_ok = not services["storage"].startswith("unavailable")
    degraded = services["llm"] != "connected" or services["tesseract_ocr"] != "available"

    payload = HealthResponse(
        status="ok" if (db_ok and storage_ok and not degraded) else ("degraded" if db_ok and storage_ok else "unhealthy"),
        environment=settings.ENV,
        services=services,
    )
    if not (db_ok and storage_ok):
        return JSONResponse(status_code=503, content=jsonable_encoder(payload))
    return payload


@router.get("/settings")
async def get_settings_endpoint():
    """Return the current runtime-editable settings (secrets masked)."""
    return {"status": "success", "settings": get_editable_settings()}


@router.put("/settings")
async def update_settings_endpoint(payload: dict):
    """
    Apply runtime setting overrides (from the backend Settings page).

    Only whitelisted keys are honoured; overrides are persisted and re-applied
    on restart. Returns the resulting editable settings.
    """
    updated = apply_settings_overrides(payload)
    return {"status": "success", "settings": updated}


@router.get("/supported-formats", response_model=SupportedFormatsResponse)
async def get_supported_formats():
    """List supported file formats."""
    return SupportedFormatsResponse(
        formats=settings.supported_formats_list,
        max_file_size_mb=settings.MAX_FILE_SIZE_MB,
    )


# =============================================================================
# Document Processing
# =============================================================================


@router.post("/process-document", response_model=ProcessDocumentResponse)
async def process_document_endpoint(
    file: UploadFile = File(...),
    run_ocr: bool = Form(default=True),
    generate_summary: bool = Form(default=True),
):
    """
    Upload and process a document.
    Extracts text, images, tables, and creates strategic chunks.

    Supports: PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG, JPEG, TIFF, BMP
    """
    # Validate file
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = Path(file.filename).suffix.lower().lstrip(".")
    if ext not in settings.supported_formats_list:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {ext}. Supported: {', '.join(settings.supported_formats_list)}",
        )

    # Read file bytes
    file_bytes = await file.read()

    if len(file_bytes) > settings.max_file_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {settings.MAX_FILE_SIZE_MB}MB",
        )

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        result = await process_document(
            file_bytes=file_bytes,
            filename=file.filename,
            file_type=file.content_type or "",
            run_ocr=run_ocr,
            generate_summary=generate_summary,
        )

        return ProcessDocumentResponse(
            status="success",
            document=result,
        )
    except Exception as e:
        logger.error("document_processing_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Document processing failed: {str(e)}")


# =============================================================================
# Ingestion (Step 1: upload -> store -> extract -> manifest)
# =============================================================================


@router.post("/ingest", response_model=IngestResponse)
async def ingest_document_endpoint(
    file: UploadFile = File(...),
    run_ocr: bool = Form(default=True),
    dedup: bool = Form(default=True),
):
    """
    Ingest a proposal document (no AI evaluation).

    Stores the original file in object storage, extracts its text, stores the
    extracted text, writes a JSON manifest indexing every storage address, and
    persists a `proposals` row with the extracted text.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = Path(file.filename).suffix.lower().lstrip(".")
    if ext not in settings.supported_formats_list:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {ext}. Supported: {', '.join(settings.supported_formats_list)}",
        )

    file_bytes = await file.read()

    if len(file_bytes) > settings.max_file_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {settings.MAX_FILE_SIZE_MB}MB",
        )

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        manifest = await ingest_document(
            file_bytes=file_bytes,
            filename=file.filename,
            content_type=file.content_type or "application/octet-stream",
            run_ocr=run_ocr,
            dedup=dedup,
        )
    except IngestionError as e:
        logger.error("ingest_failed", failure_status=e.failure_status.value, error=str(e))
        raise HTTPException(status_code=500, detail=f"Ingestion failed ({e.failure_status.value}): {str(e)}")
    except Exception as e:
        logger.error("ingest_failed_unexpected", error=str(e))
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")

    return IngestResponse(
        status="success",
        proposal_id=manifest["proposal_id"],
        deduplicated=bool(manifest.get("deduplicated", False)),
        manifest=manifest,
    )


# =============================================================================
# Categorization (Phase 2: extract -> categorize -> store JSON, no scoring)
# =============================================================================


@router.post("/categorize", response_model=CategorizeResponse)
async def categorize_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source_key: str = Form(default=""),
    source_url: str = Form(default=""),
    run_ocr: bool = Form(default=True),
    dedup: bool = Form(default=True),
):
    """
    Trigger Phase 2 processing for a file: extraction + categorization only (no
    scoring/evaluation).

    Creates a proposal row immediately with status `categorizing` and returns its
    id; the extract -> categorize -> persist work runs in the background and moves
    the row to `categorized` (or `failed`). Poll GET /proposals to see the result.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = Path(file.filename).suffix.lower().lstrip(".")
    if ext not in settings.supported_formats_list:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {ext}. Supported: {', '.join(settings.supported_formats_list)}",
        )

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(file_bytes) > settings.max_file_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {settings.MAX_FILE_SIZE_MB}MB",
        )

    repo = get_proposal_repository()

    # Idempotency: if this source object (or an identical file) was already sent,
    # return the existing proposal instead of processing again.
    if source_key:
        existing = await repo.get_by_source_key(source_key)
        if existing is not None:
            return CategorizeResponse(
                proposal_id=existing["id"],
                processing_status=existing.get("status") or ProcessingStatus.CATEGORIZING.value,
                deduplicated=True,
            )

    file_hash = hashlib.sha256(file_bytes).hexdigest()
    if dedup:
        existing = await repo.find_by_hash(file_hash)
        if existing is not None:
            return CategorizeResponse(
                proposal_id=existing["id"],
                processing_status=existing.get("status") or ProcessingStatus.CATEGORIZING.value,
                deduplicated=True,
            )

    proposal_id = str(uuid.uuid4())
    await repo.create_proposal(
        proposal_id=proposal_id,
        filename=file.filename,
        document_format=ext,
        file_content_type=file.content_type or "application/octet-stream",
        file_size_bytes=len(file_bytes),
        file_hash=file_hash,
        source_key=source_key or None,
        source_url=source_url or None,
        status=ProcessingStatus.CATEGORIZING.value,
    )

    background_tasks.add_task(
        run_categorization,
        proposal_id,
        file_bytes,
        file.filename,
        file.content_type or "application/octet-stream",
        run_ocr,
    )

    return CategorizeResponse(
        proposal_id=proposal_id,
        processing_status=ProcessingStatus.CATEGORIZING,
    )


@router.get("/categories")
async def list_categories_endpoint():
    """List distinct agri categories with counts (for the Proposals page filter)."""
    repo = get_proposal_repository()
    return {"status": "success", "categories": await repo.list_categories()}


@router.get("/processed-source-keys")
async def processed_source_keys_endpoint():
    """Source keys that already have a proposal row (processing or done).

    The upload list uses this to hide files that have already been sent for
    processing so they don't appear as still-unprocessed.
    """
    repo = get_proposal_repository()
    return {"status": "success", "items": await repo.list_source_keys()}


@router.get("/proposals/{proposal_id}", response_model=ProposalResponse)
async def get_proposal_endpoint(proposal_id: str):
    """Fetch a stored proposal record (includes extracted text and addresses)."""
    repo = get_proposal_repository()
    record = await repo.get_proposal(proposal_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return ProposalResponse(status="success", proposal=record)


@router.delete("/proposals/{proposal_id}")
async def delete_proposal_endpoint(proposal_id: str):
    """Delete a proposal: its stored artifacts (extracted text, manifest, any
    original copy in this service's bucket) and the database row.

    The caller (Node backend) is responsible for removing the source object in
    its own upload bucket; this endpoint returns the `source_key` so it can.
    """
    repo = get_proposal_repository()
    record = await repo.get_proposal(proposal_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Proposal not found")

    # Best-effort artifact cleanup — a missing object must not block the delete.
    artifact_keys = [record.get("original_key"), record.get("extracted_key"), record.get("manifest_key")]
    try:
        storage = get_storage_backend()
        for key in artifact_keys:
            if not key:
                continue
            try:
                await storage.delete(key)
            except Exception as e:
                logger.warning("proposal_artifact_delete_failed", key=key, error=str(e))
    except Exception as e:
        logger.warning("storage_unavailable_for_delete", error=str(e))

    await repo.delete_proposal(proposal_id)
    logger.info("proposal_deleted", id=proposal_id, filename=record.get("filename"))
    return {
        "status": "success",
        "deleted": proposal_id,
        "source_key": record.get("source_key"),
    }


@router.get("/proposals")
async def list_proposals_endpoint(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    category: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
):
    """List ingested/categorized proposals (summary view, newest first).

    Optional filters: `category` (agri category slug) and `status`
    (e.g. `categorized`, `categorizing`, `failed`).
    """
    repo = get_proposal_repository()
    return await repo.list_proposals(page=page, limit=limit, category=category, status=status)


# =============================================================================
# Single-File Evaluation (with persistence)
# =============================================================================


@router.post("/evaluate", response_model=EvaluationResponse)
async def evaluate_document(
    file: UploadFile = File(...),
    run_ocr: bool = Form(default=True),
    proposal_id: str = Form(default=""),
    force: bool = Form(default=False),
):
    """
    Full evaluation pipeline: process document → run all agents → persist results.

    When `proposal_id` is provided (Phase 2 flow), the stored evaluation is
    linked to that proposal, the proposal row moves to status `evaluated`, and
    repeat calls return the existing evaluation unless `force` is true.

    Returns the evaluation along with evaluation_id and file_url for later retrieval.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Idempotency: an already-evaluated proposal returns its stored report.
    if proposal_id and not force:
        try:
            existing = await get_repository().find_by_proposal(proposal_id)
        except Exception as e:
            logger.warning("evaluation_dedupe_lookup_failed", proposal_id=proposal_id, error=str(e))
            existing = None
        if existing and existing.get("evaluation_report"):
            stored = EvaluationResponse(**existing["evaluation_report"])
            stored.evaluation_id = existing["id"]
            stored.file_url = existing.get("file_storage_url") or stored.file_url
            return stored

    ext = Path(file.filename).suffix.lower().lstrip(".")
    if ext not in settings.supported_formats_list:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {ext}. Supported: {', '.join(settings.supported_formats_list)}",
        )

    file_bytes = await file.read()

    if len(file_bytes) > settings.max_file_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {settings.MAX_FILE_SIZE_MB}MB",
        )

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    start_time = time.time()

    try:
        # Step 1: Process document
        logger.info("evaluation_started", filename=file.filename)
        processed = await process_document(
            file_bytes=file_bytes,
            filename=file.filename,
            file_type=file.content_type or "",
            run_ocr=run_ocr,
            generate_summary=True,
        )

        if not processed.full_text.strip() or len(processed.full_text.split()) < 20:
            raise HTTPException(
                status_code=400,
                detail="Could not extract sufficient text from the file. Ensure it contains readable content.",
            )

        # Step 2: Run agent evaluation
        orchestrator = AgentOrchestrator()
        eval_response = await orchestrator.evaluate(document=processed)

        total_time = time.time() - start_time
        eval_response.processing_time_seconds = round(total_time, 2)

        # Step 3: Upload file to storage
        file_url = ""
        storage_key = ""
        try:
            storage = get_storage_backend()
            storage_key = StorageBackend.generate_key(file.filename)
            file_url = await storage.upload(file_bytes, storage_key, file.content_type or "application/octet-stream")
            eval_response.file_url = file_url
        except Exception as e:
            logger.warning("file_upload_failed", error=str(e))

        # Step 4: Persist to database
        evaluation_id = ""
        try:
            repo = get_repository()
            evaluation_id = await repo.save_evaluation(
                filename=file.filename,
                file_storage_key=storage_key,
                file_storage_url=file_url,
                file_size_bytes=len(file_bytes),
                file_content_type=file.content_type or "application/octet-stream",
                overall_score=eval_response.evaluation.overall_score,
                recommendation=eval_response.evaluation.recommendation,
                evaluation_report=eval_response.model_dump(mode="json"),
                document_metadata=processed.metadata.model_dump(mode="json"),
                status="completed",
                file_hash=hashlib.sha256(file_bytes).hexdigest(),
                proposal_id=proposal_id or None,
            )
            eval_response.evaluation_id = evaluation_id
        except Exception as e:
            logger.warning("evaluation_persist_failed", error=str(e))

        # Step 5: Phase 2 linkage — mark the proposal row as evaluated.
        if proposal_id and evaluation_id:
            try:
                updated = await get_proposal_repository().update_proposal(
                    proposal_id, status=ProcessingStatus.EVALUATED.value
                )
                if not updated:
                    logger.warning("evaluated_proposal_not_found", proposal_id=proposal_id)
            except Exception as e:
                logger.warning("proposal_status_update_failed", proposal_id=proposal_id, error=str(e))

        return eval_response

    except HTTPException:
        raise
    except Exception as e:
        logger.error("evaluation_failed", error=str(e), filename=file.filename)
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)}")


# =============================================================================
# Batch Evaluation
# =============================================================================


@router.post("/evaluate-batch", response_model=BatchEvaluationResponse)
async def evaluate_batch(
    files: list[UploadFile] = File(...),
):
    """
    Evaluate multiple files in a batch.

    Files are processed sequentially to respect LLM rate limits.
    Returns a batch_id for tracking and per-file results.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 files per batch")

    # Validate and read all files upfront
    file_list = []
    for f in files:
        if not f.filename:
            raise HTTPException(status_code=400, detail="All files must have a filename")
        ext = Path(f.filename).suffix.lower().lstrip(".")
        if ext not in settings.supported_formats_list:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported format for {f.filename}: {ext}",
            )
        content = await f.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail=f"Empty file: {f.filename}")
        if len(content) > settings.max_file_size_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"File too large: {f.filename}. Max: {settings.MAX_FILE_SIZE_MB}MB",
            )
        file_list.append({
            "bytes": content,
            "filename": f.filename,
            "content_type": f.content_type or "application/octet-stream",
        })

    result = await process_batch(file_list)

    return BatchEvaluationResponse(**result)


# =============================================================================
# Evaluate Pre-Processed Chunks
# =============================================================================


@router.post("/evaluate-chunks", response_model=EvaluationResponse)
async def evaluate_chunks(request: EvaluateChunksRequest):
    """
    Evaluate pre-processed document chunks.
    Use this when document processing is done separately.
    """
    if not request.chunks:
        raise HTTPException(status_code=400, detail="No chunks provided")

    start_time = time.time()

    try:
        # Build a ProcessedDocument from the chunks request
        doc = ProcessedDocument(
            metadata=request.metadata,
            full_text="\n\n".join(c.text for c in request.chunks),
            chunks=request.chunks,
            summary=request.summary,
        )

        orchestrator = AgentOrchestrator()
        eval_response = await orchestrator.evaluate(document=doc)

        total_time = time.time() - start_time
        eval_response.processing_time_seconds = round(total_time, 2)

        return eval_response
    except Exception as e:
        logger.error("chunk_evaluation_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)}")


# =============================================================================
# Reports CRUD & Comparison
# =============================================================================


@router.get("/reports", response_model=ReportListResponse)
async def list_reports(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = Query(default=None),
):
    """List all stored evaluation reports (paginated)."""
    try:
        repo = get_repository()
        result = await repo.list_evaluations(page=page, limit=limit, status=status)
        return ReportListResponse(**result)
    except Exception as e:
        logger.error("list_reports_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to list reports: {str(e)}")


@router.get("/reports/{report_id}")
async def get_report(report_id: str):
    """Get a single stored evaluation report with the full JSON."""
    try:
        repo = get_repository()
        record = await repo.get_evaluation(report_id)
        if not record:
            raise HTTPException(status_code=404, detail="Report not found")
        return {"status": "success", "data": record}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("get_report_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get report: {str(e)}")


@router.delete("/reports/{report_id}")
async def delete_report(report_id: str):
    """Delete a report and its stored file."""
    try:
        repo = get_repository()
        record = await repo.get_evaluation(report_id)
        if not record:
            raise HTTPException(status_code=404, detail="Report not found")

        # Delete file from storage
        if record.get("file_storage_key"):
            try:
                storage = get_storage_backend()
                await storage.delete(record["file_storage_key"])
            except Exception as e:
                logger.warning("file_delete_failed", key=record["file_storage_key"], error=str(e))

        # Delete from database
        await repo.delete_evaluation(report_id)

        return {"status": "success", "message": "Report deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("delete_report_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to delete report: {str(e)}")


@router.post("/reports/compare", response_model=CompareResponse)
async def compare_reports(request: CompareRequest):
    """
    Compare two or more evaluation reports.

    Returns the full reports along with a comparison summary showing
    score differences across all parameters.
    """
    try:
        repo = get_repository()
        reports = await repo.get_evaluations_by_ids(request.report_ids)

        if len(reports) < 2:
            raise HTTPException(
                status_code=404,
                detail=f"Found {len(reports)} of {len(request.report_ids)} requested reports. Need at least 2.",
            )

        # Build comparison summary
        comparison = _build_comparison(reports)

        return CompareResponse(reports=reports, comparison=comparison)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("compare_reports_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to compare reports: {str(e)}")


@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str):
    """Get all evaluation reports for a batch."""
    try:
        repo = get_repository()
        reports = await repo.get_evaluations_by_batch(batch_id)
        if not reports:
            raise HTTPException(status_code=404, detail="Batch not found or empty")

        return {
            "status": "success",
            "batch_id": batch_id,
            "total_files": len(reports),
            "completed": sum(1 for r in reports if r.get("status") == "completed"),
            "failed": sum(1 for r in reports if r.get("status") == "failed"),
            "reports": reports,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("get_batch_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get batch: {str(e)}")


# =============================================================================
# Helpers
# =============================================================================


def _build_comparison(reports: list[dict]) -> dict:
    """Build a comparison summary for multiple reports."""
    parameter_keys = [
        "problem_relevance_score",
        "solution_readiness_score",
        "pilot_design_score",
        "farmer_adoption_score",
        "scaleup_score",
        "team_capacity_score",
        "compliance_score",
    ]

    summary = {
        "total_reports": len(reports),
        "overall_scores": {},
        "parameter_scores": {},
        "recommendations": {},
        "ranking": [],
    }

    # Extract scores from each report
    for report in reports:
        report_id = report["id"]
        filename = report["filename"]
        eval_data = report.get("evaluation_report", {})
        evaluation = eval_data.get("evaluation", {}) if eval_data else {}

        overall = report.get("overall_score", 0.0)
        summary["overall_scores"][report_id] = {
            "filename": filename,
            "score": overall,
        }
        summary["recommendations"][report_id] = {
            "filename": filename,
            "recommendation": report.get("recommendation", "N/A"),
        }

        for key in parameter_keys:
            if key not in summary["parameter_scores"]:
                summary["parameter_scores"][key] = {}
            summary["parameter_scores"][key][report_id] = {
                "filename": filename,
                "score": evaluation.get(key, 0.0),
            }

    # Rank by overall score
    ranked = sorted(
        summary["overall_scores"].items(),
        key=lambda x: x[1]["score"],
        reverse=True,
    )
    summary["ranking"] = [
        {"rank": i + 1, "id": rid, "filename": data["filename"], "score": data["score"]}
        for i, (rid, data) in enumerate(ranked)
    ]

    return summary
