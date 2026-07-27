"""
Ingestion — everything that happens to a document between upload and evaluation.

This implements the flow the client described in requirement (h):

    a doc is uploaded -> it is saved -> text is extracted -> metadata is created
    -> we look in the database, and if something similar is found we cross-check
    and show BOTH to the admin, who decides whether to evaluate it or not.

and the parts of (g) that concern ingestion:

    the uploaded file is safely saved; a failed idea is managed neatly and is
    retryable; nothing is "marked successful after upload only".

The stages are deliberately separable and each is persisted as it completes, so a
crash at any point leaves a row that says exactly where it stopped and can be
resumed. Nothing here is fire-and-forget.

Cost note: only ONE LLM call happens in this whole file (metadata extraction, on
the small model). Extraction, sectioning, embedding and similarity search are all
local and cost no tokens — so ingesting a document that later turns out to be a
duplicate is nearly free, which is the entire point of gating before evaluation.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Optional

from app.agents.metadata.metadata_agent import metadata_agent
from app.config import settings
from app.services.database.proposal_repository import get_proposal_repository
from app.services.database.registry_repository import (
    get_registry_repository,
    normalize_company_name,
)
from app.services.embeddings.embedder import build_identity_text, embed_text
from app.services.processing.document_processor import process_document
from app.services.processing.sectioniser import sections_from_json
from app.services.storage.storage_backend import get_storage_backend
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Object-storage key prefixes.
ORIGINALS_PREFIX = "originals"
TEXT_PREFIX = "extracted"

_UNSAFE_KEY_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def compute_hash(file_bytes: bytes) -> str:
    """SHA-256 of the raw bytes — the exact-duplicate key and the idempotency key."""
    return hashlib.sha256(file_bytes).hexdigest()


def _safe_key(proposal_id: str, filename: str, prefix: str, suffix: str = "") -> str:
    """
    Build a storage key that cannot be influenced by the uploaded filename.

    The old `generate_key` interpolated the raw filename stem straight into the
    object key, so unicode, slashes and control characters from a user-supplied
    name flowed directly into storage paths and Content-Disposition headers. The
    proposal id is the real identifier; the name is decoration.
    """
    from pathlib import Path

    stem = _UNSAFE_KEY_CHARS.sub("_", Path(filename).stem)[:60] or "document"
    ext = _UNSAFE_KEY_CHARS.sub("", Path(filename).suffix)[:10]
    return f"{prefix}/{proposal_id}/{stem}{suffix}{ext}"


class IngestionService:
    """Upload -> store -> extract -> metadata -> embed -> similarity gate."""

    def __init__(self) -> None:
        self.proposals = get_proposal_repository()
        self.registry = get_registry_repository()

    # ------------------------------------------------------------------
    # Stage 1 — accept and persist (fast, no AI)
    # ------------------------------------------------------------------

    async def accept(
        self,
        *,
        file_bytes: bytes,
        filename: str,
        content_type: str,
        uploaded_by: Optional[str] = None,
        batch_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Take ownership of an uploaded file.

        Returns immediately after the bytes are safely stored and a row exists. The
        expensive stages run afterwards in the background, so a 25-file batch upload
        does not hold the HTTP connection open for twenty minutes.

        Exact duplicates short-circuit here: identical bytes mean we already did all
        of this, so we hand back the existing proposal rather than paying for it
        twice.
        """
        file_hash = compute_hash(file_bytes)

        existing = await self.proposals.find_by_hash(file_hash)
        if existing:
            logger.info(
                "duplicate_upload_ignored",
                proposal_id=existing["id"],
                filename=filename,
            )
            return {
                "proposal_id": existing["id"],
                "filename": filename,
                "status": existing["status"],
                "duplicate_of": existing["id"],
                "deduplicated": True,
            }

        from pathlib import Path

        ext = Path(filename).suffix.lower().lstrip(".")

        proposal_id = await self.proposals.create(
            filename=filename,
            file_hash=file_hash,
            file_format=ext,
            file_size_bytes=len(file_bytes),
            content_type=content_type,
            uploaded_by=uploaded_by,
            batch_id=batch_id,
        )

        # Store the original BEFORE anything else can fail. Requirement (g) asks
        # that uploaded documents be safely saved; if extraction later dies, the
        # source is still there to retry from and still there for an operator to
        # open and read.
        try:
            storage = get_storage_backend()
            key = _safe_key(proposal_id, filename, ORIGINALS_PREFIX)
            url = await storage.upload(file_bytes, key, content_type)
            await self.proposals.update(
                proposal_id, storage_key=key, storage_url=url, status="uploaded"
            )
        except Exception as exc:
            # We cannot store the file. Say so plainly and keep the row — an idea
            # whose document we lost must not look like a healthy one.
            await self.proposals.mark_failed(proposal_id, "storage", str(exc))
            logger.error("original_storage_failed", proposal_id=proposal_id, error=str(exc))
            return {
                "proposal_id": proposal_id,
                "filename": filename,
                "status": "failed",
                "error": f"Could not store the uploaded file: {exc}",
                "deduplicated": False,
            }

        return {
            "proposal_id": proposal_id,
            "filename": filename,
            "status": "uploaded",
            "deduplicated": False,
        }

    # ------------------------------------------------------------------
    # Stage 2 — the expensive part (background)
    # ------------------------------------------------------------------

    async def process(self, proposal_id: str) -> dict[str, Any]:
        """
        Extract -> sectionise -> metadata -> intern company/category -> embed ->
        similarity gate.

        Safe to call again on a failed proposal: that is what retry does.
        """
        proposal = await self.proposals.get(proposal_id)
        if not proposal:
            raise ValueError(f"Proposal {proposal_id} not found")
        if not proposal.get("storage_key"):
            raise ValueError(f"Proposal {proposal_id} has no stored original to process")

        storage = get_storage_backend()

        try:
            file_bytes = await storage.download(proposal["storage_key"])
        except Exception as exc:
            await self.proposals.mark_failed(proposal_id, "storage", str(exc))
            raise

        # --- extract -----------------------------------------------------
        await self.proposals.set_status(proposal_id, "extracting")
        try:
            document = await process_document(
                file_bytes=file_bytes,
                filename=proposal["filename"],
                file_type=proposal["content_type"],
                run_ocr=True,
            )
        except Exception as exc:
            await self.proposals.mark_failed(proposal_id, "extraction", str(exc))
            logger.error("extraction_failed", proposal_id=proposal_id, error=str(exc))
            raise

        # A document we cannot read is a document we must not score. Failing here is
        # far better than handing an agent 12 words and letting it invent a verdict.
        if len(document.full_text.split()) < 20:
            message = (
                "Could not extract readable text from this document. "
                "If it is a scan, the image quality may be too low for OCR."
            )
            await self.proposals.mark_failed(proposal_id, "extraction", message)
            return {"proposal_id": proposal_id, "status": "failed", "error": message}

        # Persist the text and the sections before spending anything on the LLM, so
        # a metadata failure never costs us the extraction work.
        text_key = _safe_key(
            proposal_id, proposal["filename"], TEXT_PREFIX, suffix="_text"
        )
        text_url = None
        try:
            text_url = await storage.upload(
                document.full_text.encode("utf-8"), f"{text_key}.txt", "text/plain"
            )
        except Exception as exc:
            # Non-fatal: the text is also inlined on the row below.
            logger.warning("text_storage_failed", proposal_id=proposal_id, error=str(exc))

        await self.proposals.update(
            proposal_id,
            status="extracted",
            extracted_text=document.full_text,
            text_storage_key=f"{text_key}.txt" if text_url else None,
            sections=document.sections,
            total_pages=document.metadata.total_pages,
            total_words=document.metadata.total_words,
            total_tables=document.metadata.total_tables,
            total_images=document.metadata.total_images,
            has_scanned_content=document.metadata.has_scanned_content,
        )

        # --- metadata (the one LLM call) ---------------------------------
        await self.proposals.set_status(proposal_id, "extracting")
        section_text = sections_from_json(document.sections)
        metadata = await metadata_agent.extract(
            sections=section_text,
            full_text=document.full_text,
            filename=proposal["filename"],
        )

        if metadata.get("error"):
            # Metadata is required — without a company and a category the idea
            # cannot participate in the approval ledger at all. Keep the row, keep
            # the text, record the failure, allow retry.
            await self.proposals.mark_failed(proposal_id, "metadata", metadata["error"])
            return {
                "proposal_id": proposal_id,
                "status": "failed",
                "error": metadata["error"],
            }

        company_id = await self._intern_company(metadata)
        category_id = await self._intern_category(metadata, proposal_id)

        await self.proposals.update(
            proposal_id,
            title=metadata.get("title") or proposal["filename"],
            theme=metadata.get("theme"),
            problem_statement=metadata.get("problem_statement"),
            solution_summary=metadata.get("solution_summary"),
            idea_metadata=metadata,
            company_id=company_id,
            category_id=category_id,
            secondary_categories=metadata.get("secondary_categories") or [],
            status="metadata_ready",
        )

        # --- embed + similarity gate --------------------------------------
        matches = await self._run_similarity_gate(proposal_id, metadata, document.full_text)

        if matches:
            # Hand it to a human. Requirement (h): show the admin both ideas and let
            # them decide whether to evaluate. We do NOT auto-reject — a genuine
            # near-miss (two companies solving the same problem differently) is
            # exactly the case a person needs to look at.
            await self.proposals.update(
                proposal_id, status="pending_review", review_decision="pending"
            )
            logger.info(
                "similarity_gate_triggered",
                proposal_id=proposal_id,
                matches=len(matches),
                top_similarity=matches[0]["similarity"],
            )
            return {
                "proposal_id": proposal_id,
                "status": "pending_review",
                "similar_count": len(matches),
                "matches": matches,
            }

        # Nothing like it in the archive — it can go straight to the evaluation queue.
        await self.proposals.update(
            proposal_id, status="queued", review_decision="approved_for_eval"
        )
        logger.info("proposal_queued", proposal_id=proposal_id)
        return {"proposal_id": proposal_id, "status": "queued", "similar_count": 0}

    # ------------------------------------------------------------------
    # Similarity gate
    # ------------------------------------------------------------------

    async def _run_similarity_gate(
        self, proposal_id: str, metadata: dict, full_text: str
    ) -> list[dict]:
        """
        Embed the idea and look for near-neighbours already in the database.

        Two proposals are compared on the *substance of the idea* — its title,
        theme, problem and solution — not on the whole document. Proposals from one
        accelerator share boilerplate, headers and compliance language, and
        embedding the full text would flag them as similar because their paperwork
        matches. That would be a false positive on nearly every submission and the
        admin would quickly learn to click through the warning without reading it,
        which is worse than not having the gate at all.
        """
        identity = build_identity_text(
            title=metadata.get("title"),
            theme=metadata.get("theme"),
            problem=metadata.get("problem_statement"),
            solution=metadata.get("solution_summary"),
            fallback=full_text,
        )

        embedding = await embed_text(identity)
        if not embedding:
            logger.warning("embedding_failed", proposal_id=proposal_id)
            return []

        await self.proposals.update(proposal_id, embedding=embedding)

        matches = await self.proposals.find_similar(
            embedding=embedding,
            exclude_id=proposal_id,
            limit=settings.SIMILARITY_TOP_K,
            threshold=settings.SIMILARITY_THRESHOLD,
        )
        if not matches:
            return []

        # Explain *why* each one was flagged. An admin comparing two proposals needs
        # to know whether this is "the same company resubmitting" or "a different
        # company with the same idea" — those call for opposite decisions.
        this_company = (metadata.get("company_name") or "").strip()
        this_company_norm = normalize_company_name(this_company) if this_company else ""

        for match in matches:
            reasons = [f"{match['similarity']:.0%} semantic similarity in the idea itself"]

            if this_company_norm and match.get("company_name"):
                if normalize_company_name(match["company_name"]) == this_company_norm:
                    reasons.append(
                        "Same company — this may be a resubmission of their own idea"
                    )
                else:
                    reasons.append(
                        f"Different company ({match['company_name']}) proposing a very similar idea"
                    )

            if match.get("category_id"):
                reasons.append(f"Category: {match.get('category_label')}")

            if match.get("is_evaluated"):
                reasons.append("The existing idea has already been evaluated")

            match["match_reasons"] = reasons

        await self.proposals.record_similarity_matches(proposal_id, matches)
        return matches

    # ------------------------------------------------------------------
    # Interning
    # ------------------------------------------------------------------

    async def _intern_company(self, metadata: dict) -> Optional[str]:
        name = metadata.get("company_name")
        if not name:
            return None
        try:
            return await self.registry.upsert_company(
                name,
                website=metadata.get("website"),
                contact_email=metadata.get("contact_email"),
            )
        except Exception as exc:
            logger.warning("company_intern_failed", name=name, error=str(exc))
            return None

    async def _intern_category(self, metadata: dict, proposal_id: str) -> Optional[str]:
        label = metadata.get("category")
        if not label:
            return None
        try:
            return await self.registry.upsert_category(
                label, from_proposal_id=proposal_id
            )
        except Exception as exc:
            logger.warning("category_intern_failed", label=label, error=str(exc))
            return None

    # ------------------------------------------------------------------
    # Admin resolution of the gate
    # ------------------------------------------------------------------

    async def resolve_review(
        self,
        proposal_id: str,
        *,
        evaluate: bool,
        reviewed_by: Optional[str],
        note: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        The admin has looked at the flagged pair and ruled.

        `evaluate=True`  -> not a duplicate (or a duplicate worth evaluating anyway);
                            send it into the agent pipeline.
        `evaluate=False` -> it IS a duplicate; skip it. The row and its metadata stay
                            in the database — the client asked for metadata on every
                            idea, evaluated or not — it simply never costs us an
                            evaluation.
        """
        proposal = await self.proposals.get(proposal_id)
        if not proposal:
            raise ValueError(f"Proposal {proposal_id} not found")

        if evaluate:
            await self.proposals.update(
                proposal_id,
                status="queued",
                review_decision="approved_for_eval",
                reviewed_by=reviewed_by,
                reviewed_at=_now(),
            )
            await self.proposals.resolve_similarity(
                proposal_id, status="dismissed", reviewed_by=reviewed_by, note=note
            )
            outcome = "queued"
        else:
            await self.proposals.update(
                proposal_id,
                status="skipped",
                review_decision="skipped_duplicate",
                reviewed_by=reviewed_by,
                reviewed_at=_now(),
            )
            await self.proposals.resolve_similarity(
                proposal_id,
                status="confirmed_duplicate",
                reviewed_by=reviewed_by,
                note=note,
            )
            outcome = "skipped"

        await self.registry.audit(
            action="similarity_review",
            entity_type="proposal",
            entity_id=proposal_id,
            actor_id=reviewed_by,
            payload={"evaluate": evaluate, "note": note, "outcome": outcome},
        )

        logger.info(
            "similarity_review_resolved",
            proposal_id=proposal_id,
            outcome=outcome,
            reviewed_by=reviewed_by,
        )
        return {"proposal_id": proposal_id, "status": outcome}

    async def mark_duplicate(
        self,
        proposal_id: str,
        *,
        is_duplicate: bool,
        marked_by: Optional[str],
        duplicate_of: Optional[str] = None,
        note: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        An admin's own duplicate ruling, on any proposal — not just one the gate
        flagged.

        The similarity gate is a machine's suspicion and it only fires above a
        threshold. An admin reading the metadata of two ideas will sometimes see a
        duplicate the embedding missed: same programme resubmitted with a new
        problem statement, two subsidiaries of one group, a pilot re-pitched as a
        scale-up. Requiring the gate to have flagged it first would leave that admin
        with nowhere to put the judgement, and the archive would carry a duplicate
        it knows about but cannot express.

        Marking is reversible and never destructive. The row, its metadata and its
        extracted text all stay — the idea remains searchable and can be un-marked
        and evaluated later if the judgement changes. It simply stops appearing in
        the working list and never costs an evaluation.
        """
        proposal = await self.proposals.get(proposal_id)
        if not proposal:
            raise ValueError(f"Proposal {proposal_id} not found")

        if is_duplicate and proposal.get("is_evaluated"):
            # An evaluated idea has already cost its tokens and may already carry a
            # decision in the approval ledger. Hiding it behind a duplicate flag
            # would quietly remove a scored idea from the working list.
            raise ValueError(
                "This idea has already been evaluated. Marking it a duplicate now "
                "would hide a scored result — reject it instead if it should not "
                "proceed."
            )

        if is_duplicate and duplicate_of:
            original = await self.proposals.get(duplicate_of)
            if not original:
                raise ValueError("The idea this duplicates was not found")
            if duplicate_of == proposal_id:
                raise ValueError("A proposal cannot be a duplicate of itself")

        if is_duplicate:
            await self.proposals.update(
                proposal_id,
                status="skipped",
                review_decision="skipped_duplicate",
                duplicate_of_id=duplicate_of,
                reviewed_by=marked_by,
                reviewed_at=_now(),
            )
            await self.proposals.resolve_similarity(
                proposal_id,
                status="confirmed_duplicate",
                reviewed_by=marked_by,
                note=note,
            )
        else:
            # Un-marking puts it back where it was before the ruling: ready to be
            # evaluated, with no pending gate to clear (the admin has just looked at
            # it, which is what the gate was asking for).
            await self.proposals.update(
                proposal_id,
                status="queued",
                review_decision="approved_for_eval",
                duplicate_of_id=None,
                reviewed_by=marked_by,
                reviewed_at=_now(),
            )
            await self.proposals.resolve_similarity(
                proposal_id, status="dismissed", reviewed_by=marked_by, note=note
            )

        await self.registry.audit(
            action="duplicate_marked" if is_duplicate else "duplicate_unmarked",
            entity_type="proposal",
            entity_id=proposal_id,
            actor_id=marked_by,
            payload={"duplicate_of": duplicate_of, "note": note},
        )

        logger.info(
            "duplicate_mark_updated",
            proposal_id=proposal_id,
            is_duplicate=is_duplicate,
            marked_by=marked_by,
        )
        return {
            "proposal_id": proposal_id,
            "review_decision": "skipped_duplicate" if is_duplicate else "approved_for_eval",
            "duplicate_of": duplicate_of if is_duplicate else None,
        }


def _now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(tzinfo=None)


_service: Optional[IngestionService] = None


def get_ingestion_service() -> IngestionService:
    global _service
    if _service is None:
        _service = IngestionService()
    return _service
