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
from app.services.database.analytics_repository import get_analytics_repository
from app.services.database.job_repository import get_job_repository
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
    jobs = get_job_repository()
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
        #
        # The job goes in the database, not in FastAPI's BackgroundTasks. A
        # BackgroundTask lives and dies with this process; a row survives it. The
        # operator who uploads twenty files and shuts their laptop is relying on
        # exactly that difference.
        if not accepted.get("deduplicated") and accepted["status"] == "uploaded":
            await jobs.enqueue(
                kind="ingest",
                proposal_id=accepted["proposal_id"],
                batch_id=batch_id,
                requested_by=actor.user_id,
            )

    return {
        "batch_id": batch_id,
        "total": len(results),
        "accepted": sum(1 for r in results if not r.get("deduplicated")),
        "duplicates": sum(1 for r in results if r.get("deduplicated")),
        "proposals": results,
    }


@router.post("/proposals/{proposal_id}/retry")
async def retry_proposal(proposal_id: str, actor: Actor = Depends(get_actor)):
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
    job = await get_job_repository().enqueue(
        kind="ingest",
        proposal_id=proposal_id,
        batch_id=proposal.get("batch_id"),
        requested_by=actor.user_id,
    )

    await get_registry_repository().audit(
        action="proposal_retry",
        entity_type="proposal",
        entity_id=proposal_id,
        actor_id=actor.user_id,
        payload={"attempt": proposal["retry_count"] + 1},
    )

    return {
        "proposal_id": proposal_id,
        "status": "uploaded",
        "retrying": True,
        "job_id": job["id"],
    }


# =============================================================================
# Proposals
# =============================================================================


@router.get("/proposals")
async def list_proposals(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=200),
    status: Optional[str] = Query(default=None, description="One status, or several comma-separated"),
    review_decision: Optional[str] = Query(default=None),
    is_evaluated: Optional[bool] = Query(default=None),
    category_id: Optional[str] = Query(default=None),
    company_id: Optional[str] = Query(default=None),
    batch_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    exclude_duplicates: bool = Query(default=False),
    sort_by: str = Query(default="created_at"),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
):
    """
    List proposals, filtered and sorted.

    `is_evaluated=false` combined with `exclude_duplicates=true` is the view the
    client asked for by name: ideas we hold metadata for, have never scored, and
    have not ruled out as duplicates. That is the working list an admin picks from
    when deciding what to spend an evaluation on.
    """
    return await get_proposal_repository().list_proposals(
        page=page,
        limit=limit,
        status=status,
        review_decision=review_decision,
        is_evaluated=is_evaluated,
        category_id=category_id,
        company_id=company_id,
        batch_id=batch_id,
        search=search,
        exclude_duplicates=exclude_duplicates,
        sort_by=sort_by,
        sort_order=sort_order,
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


class MarkDuplicateRequest(BaseModel):
    """An admin's own duplicate ruling on a stored idea."""

    is_duplicate: bool = True
    # Optional: which existing idea this duplicates. Recorded so the ruling can be
    # explained later, and so the pair can be shown side by side.
    duplicate_of: Optional[str] = None
    note: Optional[str] = None


class BulkDuplicateRequest(BaseModel):
    proposal_ids: list[str] = Field(min_length=1, max_length=500)
    is_duplicate: bool = True
    note: Optional[str] = None


# NOTE: every `/proposals/bulk/...` route must be declared BEFORE the
# `/proposals/{proposal_id}/...` route with the same shape. Starlette matches in
# declaration order, so the parameterised route would otherwise win and bind
# proposal_id="bulk" — a 404 that looks like a database problem.
@router.post("/proposals/bulk/duplicate")
async def bulk_mark_duplicate(
    request: BulkDuplicateRequest, actor: Actor = Depends(get_actor)
):
    """Mark or un-mark many ideas as duplicates in one go. ADMIN only."""
    service = get_ingestion_service()

    updated: list[str] = []
    skipped: list[dict] = []

    for proposal_id in request.proposal_ids:
        try:
            await service.mark_duplicate(
                proposal_id,
                is_duplicate=request.is_duplicate,
                marked_by=actor.user_id,
                note=request.note,
            )
            updated.append(proposal_id)
        except ValueError as exc:
            # One un-markable item must not abort the other thirty-nine.
            skipped.append({"proposal_id": proposal_id, "reason": str(exc)})

    return {
        "requested": len(request.proposal_ids),
        "updated": len(updated),
        "skipped": len(skipped),
        "skipped_items": skipped,
    }


@router.post("/proposals/{proposal_id}/duplicate")
async def mark_duplicate(
    proposal_id: str,
    request: MarkDuplicateRequest,
    actor: Actor = Depends(get_actor),
):
    """
    Mark (or un-mark) a stored idea as a duplicate. ADMIN only.

    Distinct from `/review`, which resolves a gate the machine opened. This is the
    admin acting on their own judgement about any idea in the archive, including
    ones the similarity gate never flagged. Reversible, and the metadata is kept
    either way.
    """
    try:
        return await get_ingestion_service().mark_duplicate(
            proposal_id,
            is_duplicate=request.is_duplicate,
            marked_by=actor.user_id,
            duplicate_of=request.duplicate_of,
            note=request.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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


def _why_not_evaluatable(proposal: dict, *, force: bool) -> Optional[str]:
    """
    Whether this proposal can be evaluated, and if not, why — in words an operator
    can act on.

    Checked at submit time rather than only in the worker so that selecting forty
    proposals and clicking Evaluate tells you immediately that six of them are
    blocked, instead of silently queueing six jobs that will fail one by one.
    """
    if proposal["review_decision"] == "pending":
        return "Awaiting a duplicate review — an admin must rule on it first"
    if proposal["review_decision"] == "skipped_duplicate":
        return "Marked as a duplicate. Un-mark it to evaluate"
    if proposal["is_evaluated"] and not force:
        return "Already evaluated — re-run it explicitly to score it again"
    if proposal["status"] in ("uploaded", "extracting", "extracted"):
        return "Still being processed — no metadata yet"
    if proposal["status"] == "failed":
        return "Processing failed; retry processing before evaluating"
    return None


class BulkEvaluateRequest(BaseModel):
    proposal_ids: list[str] = Field(min_length=1, max_length=500)
    force: bool = False


# Declared before `/proposals/{proposal_id}/evaluate` — see the note above
# `bulk_mark_duplicate`.
@router.post("/proposals/bulk/evaluate")
async def bulk_evaluate(
    request: BulkEvaluateRequest, actor: Actor = Depends(get_actor)
):
    """
    Queue many evaluations at once.

    Reports per-proposal what happened rather than a single count, because "37 of
    43 queued" is only useful if you can also see which six were not and why. The
    six are almost always the interesting ones.
    """
    proposals = get_proposal_repository()
    jobs = get_job_repository()

    queued: list[dict] = []
    skipped: list[dict] = []

    for proposal_id in request.proposal_ids:
        proposal = await proposals.get(proposal_id)
        if not proposal:
            skipped.append({"proposal_id": proposal_id, "reason": "Not found"})
            continue

        blocked = _why_not_evaluatable(proposal, force=request.force)
        if blocked:
            skipped.append(
                {
                    "proposal_id": proposal_id,
                    "title": proposal.get("title") or proposal["filename"],
                    "reason": blocked,
                }
            )
            continue

        job = await jobs.enqueue(
            kind="evaluate",
            proposal_id=proposal_id,
            batch_id=proposal.get("batch_id"),
            payload={"force": request.force},
            requested_by=actor.user_id,
        )
        queued.append({"proposal_id": proposal_id, "job_id": job["id"]})

    await get_registry_repository().audit(
        action="bulk_evaluate",
        entity_type="proposal",
        entity_id=None,
        actor_id=actor.user_id,
        payload={"requested": len(request.proposal_ids), "queued": len(queued)},
    )

    return {
        "requested": len(request.proposal_ids),
        "queued": len(queued),
        "skipped": len(skipped),
        "queued_items": queued,
        "skipped_items": skipped,
    }


@router.post("/proposals/{proposal_id}/evaluate")
async def evaluate_proposal(
    proposal_id: str,
    request: EvaluateRequest | None = None,
    actor: Actor = Depends(get_actor),
):
    """
    Queue the agent pipeline over a stored proposal.

    Returns as soon as the work is recorded, not when it finishes. An evaluation is
    minutes of paced LLM calls, and holding an HTTP connection open for it made the
    whole thing hostage to the browser: close the tab (or hit the gateway's timeout)
    and the run was orphaned. Now it is a row in the queue — the caller can leave,
    the server finishes the work, and the result is waiting on the proposal.

    Works on any proposal that has been ingested and cleared the duplicate gate,
    including one ingested months ago and never evaluated: the sections were
    persisted at ingestion, so this costs the agent calls and nothing else.
    """
    proposal = await get_proposal_repository().get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")

    force = bool(request and request.force)
    blocked = _why_not_evaluatable(proposal, force=force)
    if blocked:
        raise HTTPException(status_code=400, detail=blocked)

    job = await get_job_repository().enqueue(
        kind="evaluate",
        proposal_id=proposal_id,
        batch_id=proposal.get("batch_id"),
        payload={"force": force},
        requested_by=actor.user_id,
    )

    return {
        "proposal_id": proposal_id,
        "job_id": job["id"],
        "status": "queued",
        # True when an evaluation was already in the queue for this proposal — a
        # double-click costs nothing.
        "already_queued": job.get("deduplicated", False),
    }


@router.post("/proposals/{proposal_id}/evaluate/retry")
async def retry_evaluation(proposal_id: str, actor: Actor = Depends(get_actor)):
    """Retry an evaluation that failed. Budget-limited (see MAX_EVALUATION_RETRIES)."""
    proposal = await get_proposal_repository().get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")

    if proposal["retry_count"] >= settings.MAX_EVALUATION_RETRIES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This proposal has already failed {proposal['retry_count']} times. "
                "It needs to be looked at rather than retried again."
            ),
        )

    job = await get_job_repository().enqueue(
        kind="evaluate",
        proposal_id=proposal_id,
        batch_id=proposal.get("batch_id"),
        payload={"force": True},
        requested_by=actor.user_id,
    )
    return {"proposal_id": proposal_id, "job_id": job["id"], "status": "queued"}


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
    analytics = get_analytics_repository()

    # These are independent reads — issue them together rather than in series.
    (
        categories,
        companies,
        timeline,
        pipeline,
        duplicates,
        pending_review,
        failed,
        unevaluated,
        evaluated,
        queue,
    ) = await asyncio.gather(
        registry.approvals_by_category(),
        registry.approvals_by_company(),
        registry.approval_timeline(),
        analytics.pipeline(),
        analytics.duplicates(),
        proposals.list_proposals(review_decision="pending", limit=1),
        proposals.list_proposals(status="failed", limit=1),
        proposals.list_proposals(is_evaluated=False, limit=1),
        proposals.list_proposals(is_evaluated=True, limit=1),
        get_job_repository().stats(),
    )

    return {
        "totals": {
            "total": pipeline["total"],
            "evaluated": evaluated["total"],
            "not_evaluated": unevaluated["total"],
            # Not-evaluated minus the ones ruled duplicates and the ones still
            # waiting on a ruling: the ideas an admin can actually act on today.
            "ready_to_evaluate": pipeline["awaiting_evaluation"],
            "awaiting_review": pending_review["total"],
            "marked_duplicate": duplicates["confirmed_duplicates"],
            "failed": failed["total"],
            "approved": sum(c["approved_count"] for c in categories),
            "categories": len(categories),
            "companies": len(companies),
        },
        # The queue is on the overview on purpose. Since processing left the
        # request cycle, "the server is working on 14 things right now" is
        # otherwise invisible, and an operator would read an empty screen as a
        # broken system rather than a busy one.
        "queue": queue,
        "pipeline": pipeline["stages"],
        "by_category": categories,
        "by_company": companies,
        "timeline": timeline,
        # The companies that have won in more than one domain — the thing requirement
        # (e) exists to surface.
        "multi_category_companies": [c for c in companies if c["multi_category"]],
    }


@router.get("/analytics/pipeline")
async def analytics_pipeline():
    """Where every idea in the archive currently sits, in lifecycle order."""
    return await get_analytics_repository().pipeline()


@router.get("/analytics/scores")
async def analytics_scores():
    """
    The shape of the scoring, not just its average.

    A mean of 62 could be every proposal scoring 62, or half at 30 and half at
    94 — two portfolios that call for completely different decisions.
    """
    analytics = get_analytics_repository()
    distribution, by_category, top = await asyncio.gather(
        analytics.score_distribution(),
        analytics.score_by_category(),
        analytics.top_proposals(limit=10),
    )
    return {
        "distribution": distribution,
        "by_category": by_category,
        # Strongest ideas with no decision recorded — a worklist, not a leaderboard.
        "top_undecided": top,
    }


@router.get("/analytics/throughput")
async def analytics_throughput(months: int = Query(default=12, ge=1, le=60)):
    """Ideas received vs ideas scored, by month. The gap is the backlog."""
    return {"throughput": await get_analytics_repository().throughput(months=months)}


@router.get("/analytics/operations")
async def analytics_operations():
    """What the pipeline has cost, how reliably it runs, and where it fails."""
    analytics = get_analytics_repository()
    operations, duplicates, queue = await asyncio.gather(
        analytics.operations(),
        analytics.duplicates(),
        get_job_repository().stats(),
    )
    return {"operations": operations, "duplicates": duplicates, "queue": queue}


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
    Queue an evaluation for every proposal in a batch that has cleared the gate.

    Proposals still awaiting an admin's ruling are skipped, not driven through — the
    gate is a gate. Returns as soon as the work is queued; the worker drains it
    whether or not anyone is watching.
    """
    try:
        return await get_batch_service().evaluate_batch(
            batch_id, triggered_by=actor.user_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# =============================================================================
# The work queue
# =============================================================================


@router.get("/jobs")
async def list_jobs(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    status: Optional[str] = Query(default=None),
    kind: Optional[str] = Query(default=None),
    proposal_id: Optional[str] = Query(default=None),
):
    """
    What the server is working on, has finished, and gave up on.

    Worth having a UI for: since processing no longer happens inside a request,
    "did anything actually happen after I uploaded?" would otherwise be
    unanswerable from the outside.
    """
    return await get_job_repository().list_jobs(
        page=page, limit=limit, status=status, kind=kind, proposal_id=proposal_id
    )


@router.get("/jobs/stats")
async def job_stats():
    """Queue depth, by kind and status. Cheap enough to poll."""
    return await get_job_repository().stats()


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = await get_job_repository().get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, actor: Actor = Depends(get_actor)):
    """
    Cancel a job that has not started yet.

    A running job is left alone: it is already spending tokens, and killing it
    part-way would leave a half-written evaluation behind.
    """
    cancelled = await get_job_repository().cancel(job_id)
    if not cancelled:
        raise HTTPException(
            status_code=400,
            detail="Only a job that has not started can be cancelled.",
        )
    return {"job_id": job_id, "status": "cancelled"}


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
