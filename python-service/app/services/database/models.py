"""
SQLAlchemy models — the single system of record for AgriEval.

This schema is the authority for users, companies, proposals, evaluations,
categories, admin decisions and the audit trail. The Node gateway reads/writes
`users` only; everything else is owned by this service.

Design notes that the requirements depend on:

* Categories are NOT predefined. They are minted on first use (derived from the
  idea itself) and interned in `categories`, so "how many approved per category"
  is a GROUP BY rather than a scan of JSON blobs.
* Companies are interned in `companies` with a normalized name, so the same
  company pitching under "Acme Agri Pvt. Ltd." and "acme agri" is one row —
  that is what makes "how many ideas has this company already got approved"
  answerable across domains.
* Every approval/rejection/funding decision is an append-only row in `decisions`
  carrying its own `decided_at` plus denormalized `decision_year`/`decision_month`.
  That is what makes the timeline (requirement f) a cheap indexed query instead
  of a full-table date parse.
* `proposals.embedding` is a pgvector column used for similarity gating
  (requirement h). Metadata is always persisted, evaluated or not, via
  `is_evaluated` + `review_decision`.
"""

from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, relationship


# Dimension of the local embedding model (BAAI/bge-small-en-v1.5).
EMBEDDING_DIM = 384


def _utcnow() -> datetime:
    """Naive UTC — Postgres columns here are TIMESTAMP WITHOUT TIME ZONE."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    """SQLAlchemy declarative base."""


# =============================================================================
# Identity
# =============================================================================


class User(Base):
    """
    An operator of the system. Owned by Postgres, read by the Node gateway for
    JWT auth. Only two roles exist: ADMIN and DESK2.
    """

    __tablename__ = "users"

    id = Column(String(36), primary_key=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(16), nullable=False, default="DESK2")  # ADMIN | DESK2
    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)
    last_login_at = Column(DateTime, nullable=True)


# =============================================================================
# Interned dimensions — companies & categories
# =============================================================================


class Company(Base):
    """
    The organisation pitching an idea.

    `name_normalized` is the dedup key (lowercased, punctuation and legal
    suffixes like "pvt ltd" stripped) so one company is one row no matter how
    its name is typed on the form. Requirement (e) — "how many ideas of that
    company are already approved, even across different domains" — is a join
    through this table.
    """

    __tablename__ = "companies"

    id = Column(String(36), primary_key=True)
    name = Column(String(512), nullable=False)
    name_normalized = Column(String(512), nullable=False, unique=True, index=True)

    # Free-form identity captured from the proposals, best-effort.
    website = Column(String(512), nullable=True)
    contact_email = Column(String(255), nullable=True)

    created_at = Column(DateTime, nullable=False, default=_utcnow)

    proposals = relationship("Proposal", back_populates="company")


class Category(Base):
    """
    An idea category. Deliberately NOT a fixed enum — the taxonomy is discovered
    from the proposals themselves and interned here on first sight. Requirement
    (d) is a GROUP BY on this table's id.
    """

    __tablename__ = "categories"

    id = Column(String(36), primary_key=True)
    slug = Column(String(128), nullable=False, unique=True, index=True)
    label = Column(String(256), nullable=False)
    description = Column(Text, nullable=True)

    # Set when the category was first minted, for taxonomy-growth reporting.
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    created_from_proposal_id = Column(String(36), nullable=True)

    proposals = relationship("Proposal", back_populates="category")


# =============================================================================
# Proposals
# =============================================================================


class Proposal(Base):
    """
    One uploaded idea document, and everything we know about it.

    A row exists from the moment the file lands — before extraction, before any
    LLM call, and regardless of whether it is ever evaluated. `is_evaluated`
    plus `review_decision` are what let an admin come back later and evaluate a
    stored idea straight from the database with no re-upload.
    """

    __tablename__ = "proposals"

    id = Column(String(36), primary_key=True)

    # --- Source file -------------------------------------------------------
    filename = Column(String(512), nullable=False)
    file_format = Column(String(16), nullable=False, default="")
    file_size_bytes = Column(Integer, nullable=False, default=0)
    content_type = Column(String(128), nullable=False, default="application/octet-stream")
    # SHA-256 of the bytes — exact-duplicate detection, and idempotency key.
    file_hash = Column(String(64), nullable=False, index=True)

    # Canonical stored original. This is what the dashboard links to when an
    # operator wants to open the source document (requirement: view original).
    storage_key = Column(String(1024), nullable=True)
    storage_url = Column(Text, nullable=True)
    # Full extracted text lives in object storage; only a preview is inlined
    # below, to keep list queries from dragging megabytes of text around.
    text_storage_key = Column(String(1024), nullable=True)

    # --- Extraction --------------------------------------------------------
    extracted_text = Column(Text, nullable=True)
    text_preview = Column(Text, nullable=True)
    total_pages = Column(Integer, nullable=False, default=0)
    total_words = Column(Integer, nullable=False, default=0)
    total_tables = Column(Integer, nullable=False, default=0)
    total_images = Column(Integer, nullable=False, default=0)
    has_scanned_content = Column(Boolean, nullable=False, default=False)
    # Section title -> {start, end} char offsets, produced by the sectioniser.
    # Feeds the per-section agent routing so a finance agent never receives the
    # vision statement.
    sections = Column(JSONB, nullable=True)

    # --- Derived metadata (always generated, even if never evaluated) -------
    title = Column(String(1024), nullable=True)
    theme = Column(Text, nullable=True)
    problem_statement = Column(Text, nullable=True)
    solution_summary = Column(Text, nullable=True)
    # The raw metadata blob from the metadata agent — kept whole so we can
    # re-derive fields later without re-reading the document.
    idea_metadata = Column(JSONB, nullable=True)

    company_id = Column(String(36), ForeignKey("companies.id"), nullable=True, index=True)
    category_id = Column(String(36), ForeignKey("categories.id"), nullable=True, index=True)
    # Secondary categories, for ideas that straddle two areas.
    secondary_categories = Column(JSONB, nullable=True)

    # --- Similarity gate (requirement h) -----------------------------------
    embedding = Column(Vector(EMBEDDING_DIM), nullable=True)

    # --- Lifecycle ---------------------------------------------------------
    # uploaded -> extracting -> extracted -> metadata_ready -> pending_review
    #   -> queued -> evaluating -> evaluated | failed | skipped
    status = Column(String(32), nullable=False, default="uploaded", index=True)
    is_evaluated = Column(Boolean, nullable=False, default=False, index=True)

    # Admin's call on the similarity gate:
    #   pending | approved_for_eval | skipped_duplicate
    review_decision = Column(String(32), nullable=False, default="pending", index=True)
    reviewed_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    # The idea this one duplicates, when an admin says so. Distinct from the
    # similarity gate: the gate is the machine's suspicion, this is a human's
    # ruling, and a human may rule on an idea the gate never flagged at all.
    duplicate_of_id = Column(String(36), ForeignKey("proposals.id"), nullable=True, index=True)

    # --- Current verdict, denormalized -------------------------------------
    # The score lives in `evaluations`; a copy lives here so a listing of a
    # thousand proposals can sort and filter on score without joining the
    # report table and dragging JSONB across the wire for every row.
    latest_score = Column(Float, nullable=True, index=True)
    latest_recommendation = Column(String(64), nullable=True)
    latest_evaluation_id = Column(String(36), nullable=True)
    evaluated_at = Column(DateTime, nullable=True, index=True)

    # --- Failure handling (requirement g) ----------------------------------
    # A failed idea is NOT silently marked successful. It stays failed, keeps
    # its error, and is retryable.
    error_message = Column(Text, nullable=True)
    error_stage = Column(String(64), nullable=True)  # extraction | metadata | evaluation
    retry_count = Column(Integer, nullable=False, default=0)
    last_error_at = Column(DateTime, nullable=True)

    # --- Provenance --------------------------------------------------------
    uploaded_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    batch_id = Column(String(36), nullable=True, index=True)

    created_at = Column(DateTime, nullable=False, default=_utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)

    company = relationship("Company", back_populates="proposals")
    category = relationship("Category", back_populates="proposals")
    evaluations = relationship("Evaluation", back_populates="proposal")

    __table_args__ = (
        # The dedup fast path: same bytes, never process twice.
        Index("ix_proposals_hash_status", "file_hash", "status"),
        # Drives the "what is waiting for me?" dashboard queues.
        Index("ix_proposals_review_queue", "review_decision", "status"),
    )


class SimilarityMatch(Base):
    """
    A candidate duplicate surfaced by the similarity gate, pending an admin's
    decision. Two or more proposals can point at the same incoming proposal, so
    this is a real table rather than a JSON list on the proposal.
    """

    __tablename__ = "similarity_matches"

    id = Column(String(36), primary_key=True)

    # The newly-uploaded idea that triggered the check.
    proposal_id = Column(String(36), ForeignKey("proposals.id"), nullable=False, index=True)
    # The already-stored idea it resembles.
    matched_proposal_id = Column(String(36), ForeignKey("proposals.id"), nullable=False, index=True)

    # Cosine similarity, 0..1. Higher is more alike.
    similarity = Column(Float, nullable=False, default=0.0)
    # What tipped it off — same company, near-identical problem statement, etc.
    match_reasons = Column(JSONB, nullable=True)

    # pending | confirmed_duplicate | dismissed
    status = Column(String(32), nullable=False, default="pending", index=True)
    reviewed_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    reviewer_note = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, default=_utcnow)

    __table_args__ = (
        UniqueConstraint("proposal_id", "matched_proposal_id", name="uq_similarity_pair"),
    )


# =============================================================================
# Evaluations
# =============================================================================


class Evaluation(Base):
    """
    One evaluation run over one proposal.

    Kept separate from `proposals` (rather than flattened onto it) because a
    proposal can legitimately be evaluated more than once — a retry after a
    failure, or a forced re-run after the rubric changes — and we want the
    history, not just the latest verdict.
    """

    __tablename__ = "evaluations"

    id = Column(String(36), primary_key=True)
    proposal_id = Column(String(36), ForeignKey("proposals.id"), nullable=False, index=True)

    overall_score = Column(Float, nullable=False, default=0.0)
    recommendation = Column(String(64), nullable=False, default="Not Recommended")
    risk_level = Column(String(32), nullable=True)

    # The full EvaluationResponse, including every agent's cited evidence.
    # JSONB (not Text) so we can filter on nested scores in-database.
    report = Column(JSONB, nullable=True)
    # Per-parameter headline scores, lifted out for cheap sorting/filtering.
    parameter_scores = Column(JSONB, nullable=True)
    swot = Column(JSONB, nullable=True)

    # processing | completed | failed
    status = Column(String(32), nullable=False, default="processing", index=True)
    error_message = Column(Text, nullable=True)

    # Cost/latency roll-up, so every optimisation is measurable.
    total_tokens = Column(Integer, nullable=False, default=0)
    total_duration_ms = Column(Integer, nullable=False, default=0)
    model_used = Column(String(128), nullable=True)

    batch_id = Column(String(36), nullable=True, index=True)
    triggered_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, nullable=False, default=_utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)

    proposal = relationship("Proposal", back_populates="evaluations")

    __table_args__ = (
        Index("ix_evaluations_score", "overall_score"),
    )


# =============================================================================
# Decisions — the approval ledger
# =============================================================================


class Decision(Base):
    """
    Append-only ledger of every human call on an idea.

    This — not `proposals.status` — is the source of truth for "how many ideas
    are approved in category X" (d), "how many has this company already got
    through" (e), and "in which year and month" (f). Append-only means an idea
    that was approved and later defunded still shows correctly on the timeline
    of the month it was approved.

    `category_id` and `company_id` are denormalized onto the decision on
    purpose: if an idea is later recategorised, the historical approval counts
    for the month it was approved must not silently change underneath us.
    """

    __tablename__ = "decisions"

    id = Column(String(36), primary_key=True)
    proposal_id = Column(String(36), ForeignKey("proposals.id"), nullable=False, index=True)
    evaluation_id = Column(String(36), ForeignKey("evaluations.id"), nullable=True)

    # approved | rejected | selected_for_funding | unselected
    decision = Column(String(32), nullable=False, index=True)
    notes = Column(Text, nullable=True)

    # Frozen at decision time — see docstring.
    category_id = Column(String(36), ForeignKey("categories.id"), nullable=True, index=True)
    company_id = Column(String(36), ForeignKey("companies.id"), nullable=True, index=True)

    decided_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=False, default=_utcnow, index=True)

    # Denormalized so the timeline (f) is an indexed grouping, not a date parse
    # across the whole table every time the dashboard loads.
    decision_year = Column(Integer, nullable=False, index=True)
    decision_month = Column(Integer, nullable=False, index=True)

    __table_args__ = (
        # The exact shape of the "approvals per category per month" query.
        Index("ix_decisions_cat_time", "decision", "category_id", "decision_year", "decision_month"),
        # ...and "approvals per company per month".
        Index("ix_decisions_co_time", "decision", "company_id", "decision_year", "decision_month"),
    )


# =============================================================================
# Background work
# =============================================================================


class Job(Base):
    """
    A unit of background work, owned by the database rather than by a request.

    The previous design attached processing to FastAPI `BackgroundTasks` and ran
    evaluation inline in the HTTP handler. Both tie the work's survival to
    something outside the work: the first dies with the process, the second dies
    with the browser tab (or the gateway's timeout, whichever comes first). An
    operator who uploads twelve documents and shuts their laptop must come back
    to twelve processed ideas, not twelve abandoned ones.

    So the queue is a table. A worker inside the service claims rows with
    `FOR UPDATE SKIP LOCKED`, heartbeats while it works, and writes the outcome
    back. If the process dies mid-job the row stays `running` with a stale
    heartbeat and is reclaimed on the next sweep — the work resumes, it does not
    evaporate. Nothing about that path involves a client being connected.
    """

    __tablename__ = "jobs"

    id = Column(String(36), primary_key=True)

    # ingest   — extract, metadata, embed, duplicate gate (cheap, one small LLM call)
    # evaluate — the full agent pipeline (expensive, ~35k tokens)
    kind = Column(String(32), nullable=False, index=True)

    proposal_id = Column(String(36), ForeignKey("proposals.id"), nullable=True, index=True)
    batch_id = Column(String(36), nullable=True, index=True)
    payload = Column(JSONB, nullable=True)

    # queued -> running -> succeeded | failed | cancelled
    status = Column(String(16), nullable=False, default="queued", index=True)
    # Lower runs first. Ingestion outranks evaluation on purpose: it is cheap and
    # it is what turns an uploaded file into something an admin can make a
    # decision about, so a long evaluation backlog must never starve it.
    priority = Column(Integer, nullable=False, default=100)

    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    error = Column(Text, nullable=True)
    result = Column(JSONB, nullable=True)

    requested_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    # Lease. `heartbeat_at` going stale is how we tell "a worker is on this" from
    # "a worker died holding this".
    worker_id = Column(String(64), nullable=True)
    heartbeat_at = Column(DateTime, nullable=True)
    # Retries come back with a delay rather than immediately, so a failure that
    # is really a rate limit is not hammered three times in three seconds.
    available_at = Column(DateTime, nullable=False, default=_utcnow, index=True)

    created_at = Column(DateTime, nullable=False, default=_utcnow, index=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    __table_args__ = (
        # The claim query, exactly.
        Index("ix_jobs_claim", "status", "available_at", "priority"),
        # "is there already a job for this proposal?" — the enqueue-time dedupe
        # that keeps a double-click from paying for two evaluations.
        Index("ix_jobs_pending", "kind", "proposal_id", "status"),
    )


# =============================================================================
# Audit
# =============================================================================


class AuditLog(Base):
    """
    Who did what, when. The system is meant to run for years across multiple
    operators; without this, an approval is untraceable.
    """

    __tablename__ = "audit_log"

    id = Column(String(36), primary_key=True)
    actor_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String(64), nullable=False, index=True)
    entity_type = Column(String(32), nullable=False)
    entity_id = Column(String(36), nullable=True, index=True)
    payload = Column(JSONB, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow, index=True)
