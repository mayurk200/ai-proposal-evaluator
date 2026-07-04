"""
FastAPI API routes for document processing, evaluation, storage, and report comparison.
"""

import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile, Form, Query

from app.config import settings, apply_settings_overrides, get_editable_settings
from app.models.schemas import (
    BatchEvaluationResponse,
    CompareRequest,
    CompareResponse,
    DocumentMetadata,
    ErrorResponse,
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
from app.services.processing.document_processor import process_document
from app.services.processing.batch_processor import process_batch
from app.services.processing.ingestion_service import IngestionError, ingest_document
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
    """Health check endpoint."""
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

    # Check database
    try:
        repo = get_repository()
        await repo.list_evaluations(page=1, limit=1)
        services["database"] = "connected"
    except Exception:
        services["database"] = "disconnected"

    # Check storage
    try:
        storage = get_storage_backend()
        services["storage"] = f"{settings.STORAGE_PROVIDER} (ok)"
    except Exception:
        services["storage"] = "unavailable"

    return HealthResponse(
        status="ok",
        environment=settings.ENV,
        services=services,
    )


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


@router.get("/proposals/{proposal_id}", response_model=ProposalResponse)
async def get_proposal_endpoint(proposal_id: str):
    """Fetch a stored proposal record (includes extracted text and addresses)."""
    repo = get_proposal_repository()
    record = await repo.get_proposal(proposal_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return ProposalResponse(status="success", proposal=record)


@router.get("/proposals")
async def list_proposals_endpoint(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    """List ingested proposals (summary view, newest first)."""
    repo = get_proposal_repository()
    return await repo.list_proposals(page=page, limit=limit)


# =============================================================================
# Single-File Evaluation (with persistence)
# =============================================================================


@router.post("/evaluate", response_model=EvaluationResponse)
async def evaluate_document(
    file: UploadFile = File(...),
    run_ocr: bool = Form(default=True),
):
    """
    Full evaluation pipeline: process document → run all agents → persist results.

    Returns the evaluation along with evaluation_id and file_url for later retrieval.
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
            )
            eval_response.evaluation_id = evaluation_id
        except Exception as e:
            logger.warning("evaluation_persist_failed", error=str(e))

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
