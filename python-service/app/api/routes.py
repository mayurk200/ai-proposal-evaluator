"""
API routes.

The surface is organised around the proposal lifecycle rather than around one-shot
"upload a file, get a score" calls. A proposal is ingested, gets metadata, passes
(or fails) the duplicate gate, and is then evaluated — each of those is
addressable, retryable and observable, which is what makes the failure handling in
requirement (g) possible at all.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
)
from pydantic import BaseModel, Field

from app.api.dependencies import Actor, get_actor, verify_llm_connection
from app.config import settings
from app.models.schemas import HealthResponse, SupportedFormatsResponse
from app.services.database.proposal_repository import get_proposal_repository
from app.services.database.registry_repository import get_registry_repository
from app.services.database.repository import get_repository
from app.services.processing.batch_service import get_batch_service
from app.services.processing.decision_service import (
    DecisionConflict,
    DecisionError,
    get_decision_service,
)
from app.services.processing.evaluation_service import (
    EvaluationError,
    get_evaluation_service,
)
from app.services.processing.ingestion_service import get_ingestion_service
from app.services.reporting.pdf_exporter import build_evaluation_pdf
from app.services.storage.storage_backend import get_storage_backend
from app.utils.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1")


# =============================================================================
# Health & info
# =============================================================================


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Distinguishes hard dependencies from soft ones.

    Database or storage down means we cannot accept or record a proposal at all —
    that is a 503, and the orchestrator should act on it. The LLM being down is
    degraded, not dead: ingestion, listing and review still work, only evaluation
    stops.
    """
    services: dict[str, str] = {}
    healthy = True

    try:
        await get_repository().list_evaluations(page=1, limit=1)
        services["database"] = "connected"
    except Exception as exc:
        services["database"] = f"disconnected: {exc}"
        healthy = False

    try:
        get_storage_backend()
        services["storage"] = f"{settings.STORAGE_PROVIDER} (ok)"
    except Exception as exc:
        services["storage"] = f"unavailable: {exc}"
        healthy = False

    services["llm"] = "connected" if verify_llm_connection() else "disconnected"

    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        services["ocr"] = "available"
    except Exception:
        services["ocr"] = "unavailable"

    status = "ok" if healthy else "unhealthy"
    if healthy and services["llm"] != "connected":
        status = "degraded"

    return Response(
        content=HealthResponse(
            status=status, environment=settings.ENV, services=services
        ).model_dump_json(),
        media_type="application/json",
        status_code=200 if healthy else 503,
    )


@router.get("/supported-formats", response_model=SupportedFormatsResponse)
async def supported_formats():
    return SupportedFormatsResponse(
        formats=settings.supported_formats_list,
        max_file_size_mb=settings.MAX_FILE_SIZE_MB,
    )


# =============================================================================
# Ingestion
# =============================================================================


def _validate_upload(filename: str, content: bytes) -> str:
    """Shared validation. Returns the extension."""
    if not filename:
        raise HTTPException(status_code=400, detail="A filename is required")

    ext = Path(filename).suffix.lower().lstrip(".")
    if ext not in settings.supported_formats_list:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported format '{ext}' for {filename}. "
                f"Supported: {', '.join(settings.supported_formats_list)}"
            ),
        )
    if not content:
        raise HTTPException(status_code=400, detail=f"{filename} is empty")
    if len(content) > settings.max_file_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"{filename} exceeds the {settings.MAX_FILE_SIZE_MB}MB limit",
        )
    return ext


@router.post("/proposals/ingest")
async def ingest_proposals(
    background: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    files: Optional[list[UploadFile]] = File(default=None),
    batch_id: Optional[str] = Form(default=None),
    actor: Actor = Depends(get_actor),
):
    """
    Accept one or more documents (batch upload is the same endpoint).

    Returns as soon as the bytes are safely stored and a row exists for each file.
    Extraction, metadata and the duplicate check happen in the background — a
    25-file batch must not hold an HTTP connection open for twenty minutes.

    Poll `GET /proposals` (or the individual proposal) to watch each one progress.
    Nothing is reported as successful merely because the upload landed.
    """
    incoming = files or ([file] if file else [])
    if not incoming:
        raise HTTPException(status_code=400, detail="No files provided")

    if len(incoming) > 25:
        raise HTTPException(status_code=400, detail="Maximum 25 files per upload")

    # Validate everything up front. Rejecting the batch before any work starts beats
    # processing nine files and then failing on the tenth.
    payloads = []
    for upload in incoming:
        content = await upload.read()
        _validate_upload(upload.filename or "", content)
        payloads.append(
            (content, upload.filename or "", upload.content_type or "application/octet-stream")
        )

    # A multi-file upload is a batch whether the caller said so or not — grouping it
    # is what lets the UI show "7 of 12 processed" instead of twelve unrelated rows.
    if not batch_id and len(payloads) > 1:
        batch_id = str(uuid.uuid4())

    service = get_ingestion_service()
    results = []

    for content, filename, content_type in payloads:
        accepted = await service.accept(
            file_bytes=content,
            filename=filename,
            content_type=content_type,
            uploaded_by=actor.user_id,
            batch_id=batch_id,
        )
        results.append(accepted)

        # Only schedule work for files that are actually new and actually stored.
        if not accepted.get("deduplicated") and accepted["status"] == "uploaded":
            background.add_task(_process_proposal, accepted["proposal_id"])

    return {
        "batch_id": batch_id,
        "total": len(results),
        "accepted": sum(1 for r in results if not r.get("deduplicated")),
        "duplicates": sum(1 for r in results if r.get("deduplicated")),
        "proposals": results,
    }


async def _process_proposal(proposal_id: str) -> None:
    """
    Background worker.

    Swallows exceptions on purpose: `process()` has already recorded the failure on
    the proposal row (stage + message + retry count), so re-raising here would only
    produce an unhandled-task traceback in the logs with nowhere to go. The failure
    is visible in the retry queue, which is where an operator will actually see it.
    """
    try:
        await get_ingestion_service().process(proposal_id)
    except Exception as exc:
        logger.error("background_processing_failed", proposal_id=proposal_id, error=str(exc))


@router.post("/proposals/{proposal_id}/retry")
async def retry_proposal(
    proposal_id: str,
    background: BackgroundTasks,
    actor: Actor = Depends(get_actor),
):
    """
    Re-run processing on a failed proposal.

    Requirement (g): a failed idea "should be managed neatly and should be retried".
    The original document is already stored, so a retry costs no re-upload — it
    picks up from the stored bytes.
    """
    proposals = get_proposal_repository()
    proposal = await proposals.get(proposal_id)

    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if proposal["status"] != "failed":
        raise HTTPException(
            status_code=400,
            detail=f"Only failed proposals can be retried (this one is '{proposal['status']}')",
        )
    if proposal["retry_count"] >= settings.MAX_EVALUATION_RETRIES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This proposal has already failed {proposal['retry_count']} times. "
                "It needs a human to look at the document."
            ),
        )

    await proposals.update(proposal_id, status="uploaded", error_message=None, error_stage=None)
    background.add_task(_process_proposal, proposal_id)

    await get_registry_repository().audit(
        action="proposal_retry",
        entity_type="proposal",
        entity_id=proposal_id,
        actor_id=actor.user_id,
        payload={"attempt": proposal["retry_count"] + 1},
    )

    return {"proposal_id": proposal_id, "status": "uploaded", "retrying": True}


# =============================================================================
# Proposals
# =============================================================================


@router.get("/proposals")
async def list_proposals(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = Query(default=None),
    review_decision: Optional[str] = Query(default=None),
    is_evaluated: Optional[bool] = Query(default=None),
    category_id: Optional[str] = Query(default=None),
    company_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
):
    """
    List proposals, filtered.

    `is_evaluated=false` is the "ideas we hold metadata for but have never scored"
    view — the one an admin uses to pick a stored idea and evaluate it later,
    without re-uploading the document.
    """
    return await get_proposal_repository().list_proposals(
        page=page,
        limit=limit,
        status=status,
        review_decision=review_decision,
        is_evaluated=is_evaluated,
        category_id=category_id,
        company_id=company_id,
        search=search,
    )


@router.get("/proposals/{proposal_id}")
async def get_proposal(proposal_id: str):
    """One proposal, with its evaluation history and its company's approval record."""
    proposals = get_proposal_repository()
    proposal = await proposals.get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")

    evaluations = await get_repository().list_for_proposal(proposal_id)
    latest = await get_repository().get_latest_for_proposal(proposal_id)

    registry = get_registry_repository()

    # The evaluator is about to make a call on this idea. Requirement (e) says they
    # must be able to see what else this company has already had approved — so it
    # travels with the proposal rather than being a separate page they might not open.
    company_context = None
    if proposal.get("company_id"):
        company_context = await registry.company_approval_context(proposal["company_id"])

    return {
        "proposal": proposal,
        "evaluations": evaluations,
        "latest_evaluation": latest,
        "decision": await registry.latest_decision(proposal_id),
        "company_context": company_context,
        "similar": await proposals.get_similarity_matches(proposal_id),
    }


@router.get("/proposals/{proposal_id}/file")
async def get_proposal_file(proposal_id: str):
    """
    Stream the original document.

    Requirement: when viewing an approved/selected idea, an operator must be able to
    open the file it was scored from. The bytes are streamed through an
    authenticated route rather than exposed as a public storage URL.
    """
    proposal = await get_proposal_repository().get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if not proposal.get("storage_key"):
        raise HTTPException(status_code=404, detail="No stored original for this proposal")

    try:
        content = await get_storage_backend().download(proposal["storage_key"])
    except Exception as exc:
        logger.error("file_fetch_failed", proposal_id=proposal_id, error=str(exc))
        raise HTTPException(status_code=502, detail=f"Could not read the stored file: {exc}")

    return Response(
        content=content,
        media_type=proposal["content_type"],
        headers={"X-Filename": proposal["filename"]},
    )


@router.delete("/proposals/{proposal_id}")
async def delete_proposal(proposal_id: str, actor: Actor = Depends(get_actor)):
    """Delete a proposal and its stored artifacts. Best-effort on storage — a
    missing object must never block the database delete."""
    proposals = get_proposal_repository()
    proposal = await proposals.get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")

    storage = get_storage_backend()
    for key in (proposal.get("storage_key"), proposal.get("text_storage_key")):
        if key:
            try:
                await storage.delete(key)
            except Exception as exc:
                logger.warning("artifact_delete_failed", key=key, error=str(exc))

    await proposals.delete(proposal_id)

    await get_registry_repository().audit(
        action="proposal_deleted",
        entity_type="proposal",
        entity_id=proposal_id,
        actor_id=actor.user_id,
        payload={"filename": proposal["filename"]},
    )

    return {"deleted": True, "proposal_id": proposal_id}


# =============================================================================
# The duplicate gate
# =============================================================================


class ReviewRequest(BaseModel):
    """An admin's ruling on a flagged near-duplicate."""

    evaluate: bool = Field(
        description=(
            "True: not a duplicate (or worth evaluating anyway) — send it to the "
            "agents. False: it IS a duplicate — skip it. Either way the metadata is "
            "kept."
        )
    )
    note: Optional[str] = None


@router.get("/proposals/{proposal_id}/similar")
async def get_similar(proposal_id: str):
    """
    The ideas this one resembles, with the reason each was flagged.

    This is what the admin sees side by side before deciding whether to evaluate.
    """
    proposals = get_proposal_repository()
    proposal = await proposals.get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")

    return {
        "proposal": proposal,
        "matches": await proposals.get_similarity_matches(proposal_id),
    }


@router.post("/proposals/{proposal_id}/review")
async def review_proposal(
    proposal_id: str,
    request: ReviewRequest,
    actor: Actor = Depends(get_actor),
):
    """Resolve the duplicate gate. ADMIN only — enforced at the gateway."""
    try:
        return await get_ingestion_service().resolve_review(
            proposal_id,
            evaluate=request.evaluate,
            reviewed_by=actor.user_id,
            note=request.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/review-queue")
async def review_queue(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    """Everything waiting on an admin's duplicate ruling."""
    return await get_proposal_repository().list_proposals(
        page=page, limit=limit, review_decision="pending", status="pending_review"
    )


@router.get("/retry-queue")
async def retry_queue(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    """
    Everything that failed.

    Requirement (g) again: failures are a queue an operator works through, not
    silence.
    """
    result = await get_proposal_repository().list_proposals(
        page=page, limit=limit, status="failed"
    )
    for proposal in result["proposals"]:
        proposal["can_retry"] = proposal["retry_count"] < settings.MAX_EVALUATION_RETRIES
    return result


# =============================================================================
# Evaluation
# =============================================================================


class EvaluateRequest(BaseModel):
    # Re-run an evaluation that already completed. Costs a full pipeline, so it is
    # opt-in rather than the default.
    force: bool = False


@router.post("/proposals/{proposal_id}/evaluate")
async def evaluate_proposal(
    proposal_id: str,
    request: EvaluateRequest | None = None,
    actor: Actor = Depends(get_actor),
):
    """
    Run the agent pipeline over a stored proposal.

    Works on any proposal that has been ingested and cleared the duplicate gate —
    including one ingested months ago and never evaluated. The document is not
    re-read: sections were persisted at ingestion, so this costs the agent calls
    and nothing else. That is what makes "let the admin evaluate a stored idea from
    the database, without re-uploading it" practical.

    Idempotent: a proposal that already has a completed evaluation returns it,
    unless `force`.
    """
    try:
        result = await get_evaluation_service().evaluate(
            proposal_id,
            triggered_by=actor.user_id,
            force=bool(request and request.force),
        )
    except EvaluationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return result


@router.post("/proposals/{proposal_id}/evaluate/retry")
async def retry_evaluation(proposal_id: str, actor: Actor = Depends(get_actor)):
    """Retry an evaluation that failed. Budget-limited (see MAX_EVALUATION_RETRIES)."""
    try:
        return await get_evaluation_service().retry(
            proposal_id, triggered_by=actor.user_id
        )
    except EvaluationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/evaluations/{evaluation_id}")
async def get_evaluation(evaluation_id: str):
    """One evaluation report, including every agent's cited evidence."""
    record = await get_repository().get(evaluation_id)
    if not record:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return record


@router.get("/evaluations")
async def list_evaluations(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = Query(default=None),
):
    return await get_repository().list_evaluations(page=page, limit=limit, status=status)


@router.get("/evaluations/{evaluation_id}/export")
async def export_evaluation_pdf(evaluation_id: str):
    """
    Export an evaluation report as PDF (requirement g).

    The PDF carries the cited evidence behind every score, not just the numbers — which
    is what makes it something an evaluator can hand to an applicant or an auditor.
    """
    evaluation = await get_repository().get(evaluation_id)
    if not evaluation:
        raise HTTPException(status_code=404, detail="Evaluation not found")

    proposals = get_proposal_repository()
    proposal = await proposals.get(evaluation["proposal_id"])
    if not proposal:
        raise HTTPException(status_code=404, detail="The evaluated proposal no longer exists")

    decision = await get_registry_repository().latest_decision(proposal["id"])

    # ReportLab is synchronous and a long report is real CPU work — keep it off the
    # event loop.
    pdf = await asyncio.to_thread(
        build_evaluation_pdf,
        evaluation=evaluation,
        proposal=proposal,
        decision=decision,
    )

    stem = Path(proposal["filename"]).stem[:60] or "evaluation"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", stem)

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"X-Filename": f"{safe}_evaluation.pdf"},
    )


# =============================================================================
# Decisions — the approval ledger
# =============================================================================


class DecisionRequest(BaseModel):
    decision: str = Field(
        description="approved | rejected | selected_for_funding | unselected"
    )
    notes: Optional[str] = None
    # Approving into a category that already has an approval — or from a company that
    # has already won — is refused unless the evaluator says, explicitly, that they
    # mean it. The override is recorded against their name.
    acknowledge_conflicts: bool = False


class FundingRequest(BaseModel):
    selected: bool = True
    notes: Optional[str] = None
    acknowledge_conflicts: bool = False


@router.get("/proposals/{proposal_id}/conflicts")
async def get_conflicts(proposal_id: str):
    """
    What approving this idea would collide with.

    Read-only, so the UI can warn the evaluator BEFORE they click rather than rejecting
    them afterwards: which other idea already holds this category, and what else this
    company has already been approved for.
    """
    try:
        return {"conflicts": await get_decision_service().check_conflicts(proposal_id)}
    except DecisionError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/proposals/{proposal_id}/decision")
async def record_decision(
    proposal_id: str,
    request: DecisionRequest,
    actor: Actor = Depends(get_actor),
):
    """Approve or reject an idea. ADMIN only — enforced at the gateway."""
    try:
        return await get_decision_service().decide(
            proposal_id,
            decision=request.decision,
            decided_by=actor.user_id,
            notes=request.notes,
            acknowledge_conflicts=request.acknowledge_conflicts,
        )
    except DecisionConflict as exc:
        # 409, with the detail needed to show the evaluator exactly what they are about
        # to do — not a bare "are you sure?".
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "conflicts": exc.conflicts},
        )
    except DecisionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/proposals/{proposal_id}/funding")
async def mark_funding(
    proposal_id: str,
    request: FundingRequest,
    actor: Actor = Depends(get_actor),
):
    """Mark (or unmark) an idea as selected for funding. ADMIN only."""
    try:
        return await get_decision_service().mark_for_funding(
            proposal_id,
            selected=request.selected,
            decided_by=actor.user_id,
            notes=request.notes,
            acknowledge_conflicts=request.acknowledge_conflicts,
        )
    except DecisionConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "conflicts": exc.conflicts},
        )
    except DecisionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# =============================================================================
# Analytics — requirements (d), (e), (f)
# =============================================================================


@router.get("/analytics/categories")
async def analytics_categories(year: Optional[int] = Query(default=None)):
    """
    (d) How many ideas are approved in each category.

    This is the number an evaluator checks before approving another idea into a
    category that already has one.
    """
    return {
        "categories": await get_registry_repository().approvals_by_category(year=year)
    }


@router.get("/analytics/companies")
async def analytics_companies(year: Optional[int] = Query(default=None)):
    """
    (e) How many ideas each company has had approved, and across how many categories.

    `multi_category` is the flag the client asked for: one company winning in more than
    one domain.
    """
    return {
        "companies": await get_registry_repository().approvals_by_company(year=year)
    }


@router.get("/analytics/timeline")
async def analytics_timeline(
    year: Optional[int] = Query(default=None),
    group_by: str = Query(default="category", pattern="^(category|company)$"),
):
    """(f) Approvals bucketed by the year and month they actually happened in."""
    return {
        "timeline": await get_registry_repository().approval_timeline(
            year=year, group_by=group_by
        )
    }


@router.get("/analytics/overview")
async def analytics_overview():
    """Everything the dashboard needs, in one round trip."""
    registry = get_registry_repository()
    proposals = get_proposal_repository()

    # These are independent reads — issue them together rather than in series.
    (
        categories,
        companies,
        timeline,
        pending_review,
        failed,
        unevaluated,
        evaluated,
    ) = await asyncio.gather(
        registry.approvals_by_category(),
        registry.approvals_by_company(),
        registry.approval_timeline(),
        proposals.list_proposals(review_decision="pending", limit=1),
        proposals.list_proposals(status="failed", limit=1),
        proposals.list_proposals(is_evaluated=False, limit=1),
        proposals.list_proposals(is_evaluated=True, limit=1),
    )

    return {
        "totals": {
            "evaluated": evaluated["total"],
            "not_evaluated": unevaluated["total"],
            "awaiting_review": pending_review["total"],
            "failed": failed["total"],
            "approved": sum(c["approved_count"] for c in categories),
            "categories": len(categories),
            "companies": len(companies),
        },
        "by_category": categories,
        "by_company": companies,
        "timeline": timeline,
        # The companies that have won in more than one domain — the thing requirement
        # (e) exists to surface.
        "multi_category_companies": [c for c in companies if c["multi_category"]],
    }


# =============================================================================
# Batches
# =============================================================================


@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str):
    """Where a batch has got to, and what is stuck."""
    try:
        return await get_batch_service().get_batch(batch_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/batches/{batch_id}/evaluate")
async def evaluate_batch(batch_id: str, actor: Actor = Depends(get_actor)):
    """
    Evaluate every proposal in a batch that has cleared the duplicate gate.

    Proposals still awaiting an admin's ruling are skipped, not driven through — the
    gate is a gate. Per-proposal failures do not stop the batch.
    """
    try:
        return await get_batch_service().evaluate_batch(
            batch_id, triggered_by=actor.user_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# =============================================================================
# Categories
# =============================================================================


@router.get("/categories")
async def list_categories():
    """
    The discovered taxonomy.

    Not a fixed list — these are the categories the submitted ideas turned out to
    be about, minted as they arrived.
    """
    return {"categories": await get_registry_repository().list_categories()}
