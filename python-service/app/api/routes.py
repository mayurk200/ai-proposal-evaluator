"""
FastAPI API routes for document processing and evaluation.
Hardened with global timeouts, request ID tracking, and structured error responses.
"""

import asyncio
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile, Form

from app.config import settings
from app.models.schemas import (
    ErrorResponse,
    EvaluateChunksRequest,
    EvaluationResponse,
    HealthResponse,
    ProcessDocumentResponse,
    SupportedFormatsResponse,
)
from app.services.processing.document_processor import process_document
from app.agents.orchestrator import AgentOrchestrator
from app.api.dependencies import verify_llm_connection
from app.utils.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1")


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

    return HealthResponse(
        status="ok",
        environment=settings.ENV,
        services=services,
    )


@router.get("/supported-formats", response_model=SupportedFormatsResponse)
async def get_supported_formats():
    """List supported file formats."""
    return SupportedFormatsResponse(
        formats=settings.supported_formats_list,
        max_file_size_mb=settings.MAX_FILE_SIZE_MB,
    )


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
    request_id = str(uuid.uuid4())[:8]

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
        logger.info("process_document_started", request_id=request_id, filename=file.filename)

        result = await process_document(
            file_bytes=file_bytes,
            filename=file.filename,
            file_type=file.content_type or "",
            run_ocr=run_ocr,
            generate_summary=generate_summary,
        )

        logger.info("process_document_completed", request_id=request_id)

        return ProcessDocumentResponse(
            status="success",
            document=result,
        )
    except Exception as e:
        logger.error("document_processing_failed", request_id=request_id, error=str(e)[:300])
        raise HTTPException(status_code=500, detail=f"Document processing failed: {str(e)[:200]}")


@router.post("/evaluate", response_model=EvaluationResponse)
async def evaluate_document(
    file: UploadFile = File(...),
    run_ocr: bool = Form(default=True),
):
    """
    Full evaluation pipeline: process document → run all agents → return evaluation.

    This is the main endpoint for complete proposal evaluation.
    Includes global timeout protection.
    """
    request_id = str(uuid.uuid4())[:8]

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
        logger.info("evaluation_started", request_id=request_id, filename=file.filename)

        # Step 1: Process document
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

        # Step 2: Run agent evaluation with global timeout
        orchestrator = AgentOrchestrator()
        try:
            eval_result = await asyncio.wait_for(
                orchestrator.evaluate(
                    chunks=processed.chunks,
                    metadata=processed.metadata,
                    summary=processed.summary,
                ),
                timeout=settings.EVALUATION_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.error(
                "evaluation_timeout",
                request_id=request_id,
                filename=file.filename,
                timeout=settings.EVALUATION_TIMEOUT_SECONDS,
            )
            raise HTTPException(
                status_code=504,
                detail=f"Evaluation timed out after {settings.EVALUATION_TIMEOUT_SECONDS}s. "
                       "The document may be too large or the service is under heavy load.",
            )

        total_time = time.time() - start_time

        logger.info(
            "evaluation_completed",
            request_id=request_id,
            filename=file.filename,
            total_time=round(total_time, 2),
        )

        return EvaluationResponse(
            status="success",
            document_metadata=processed.metadata,
            evaluation=eval_result["final_evaluation"],
            agent_results=eval_result["agent_results"],
            processing_time_seconds=round(total_time, 2),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "evaluation_failed",
            request_id=request_id,
            error=str(e)[:300],
            filename=file.filename,
        )
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)[:200]}")


@router.post("/evaluate-chunks", response_model=EvaluationResponse)
async def evaluate_chunks(request: EvaluateChunksRequest):
    """
    Evaluate pre-processed document chunks.
    Use this when document processing is done separately.
    """
    request_id = str(uuid.uuid4())[:8]

    if not request.chunks:
        raise HTTPException(status_code=400, detail="No chunks provided")

    start_time = time.time()

    try:
        logger.info("chunk_evaluation_started", request_id=request_id)

        orchestrator = AgentOrchestrator()
        try:
            eval_result = await asyncio.wait_for(
                orchestrator.evaluate(
                    chunks=request.chunks,
                    metadata=request.metadata,
                    summary=request.summary,
                ),
                timeout=settings.EVALUATION_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.error("chunk_evaluation_timeout", request_id=request_id)
            raise HTTPException(
                status_code=504,
                detail=f"Evaluation timed out after {settings.EVALUATION_TIMEOUT_SECONDS}s.",
            )

        total_time = time.time() - start_time

        logger.info("chunk_evaluation_completed", request_id=request_id, total_time=round(total_time, 2))

        return EvaluationResponse(
            status="success",
            document_metadata=request.metadata,
            evaluation=eval_result["final_evaluation"],
            agent_results=eval_result["agent_results"],
            processing_time_seconds=round(total_time, 2),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("chunk_evaluation_failed", request_id=request_id, error=str(e)[:300])
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)[:200]}")
