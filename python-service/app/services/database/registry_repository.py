"""
The approval ledger and its dimensions.

This module answers the three questions the client actually cares about:

  (d) How many ideas are approved in each category — so we stop approving a
      second idea in a category we have already funded.
  (e) How many ideas has this company already had approved — including across
      different categories, so one company cannot quietly win several slots by
      pitching into different domains.
  (f) ...and in which year and month each of those approvals happened.

All three are reads over `decisions`, which is append-only. Nothing here mutates
history: an idea that is approved in March and defunded in June still counts as a
March approval on the timeline, because that is what actually happened.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select

from app.services.database.models import (
    AuditLog,
    Category,
    Company,
    Decision,
    Proposal,
)
from app.services.database.session import get_session_factory
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Legal-form suffixes that are noise for identity purposes. "Acme Agri Pvt Ltd",
# "Acme Agri Private Limited" and "ACME AGRI" are one company.
_LEGAL_SUFFIXES = re.compile(
    r"\b(pvt|private|ltd|limited|llp|inc|incorporated|corp|corporation|co|company|"
    r"technologies|technology|tech|solutions|labs|laboratories|industries|"
    r"enterprises|ventures|innovations|agritech|agro)\b",
    re.IGNORECASE,
)
_NON_ALNUM = re.compile(r"[^a-z0-9\s]")
_WHITESPACE = re.compile(r"\s+")


def normalize_company_name(name: str) -> str:
    """
    Reduce a company name to a stable identity key.

    Lowercase, strip punctuation, drop legal-form and generic industry suffixes,
    collapse whitespace. Deliberately conservative: it is far worse to merge two
    genuinely different companies than to leave a near-duplicate unmerged, so we
    only strip tokens that carry no distinguishing information.

    If stripping suffixes would leave nothing (a company literally called
    "Agritech Solutions"), we fall back to the punctuation-stripped name rather
    than collapsing it to the empty string — which would merge every such company
    into one row.
    """
    lowered = name.strip().lower()
    cleaned = _NON_ALNUM.sub(" ", lowered)
    stripped = _LEGAL_SUFFIXES.sub(" ", cleaned)
    result = _WHITESPACE.sub(" ", stripped).strip()
    return result or _WHITESPACE.sub(" ", cleaned).strip()


def slugify(label: str) -> str:
    """Turn a free-text category label into a stable slug."""
    lowered = _NON_ALNUM.sub(" ", label.strip().lower())
    return _WHITESPACE.sub("-", lowered).strip("-") or "uncategorized"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class RegistryRepository:
    """Companies, categories, decisions, audit."""

    def __init__(self) -> None:
        self._sessions = get_session_factory()

    # ------------------------------------------------------------------
    # Companies
    # ------------------------------------------------------------------

    async def upsert_company(self, name: str, **extra: Optional[str]) -> str:
        """
        Intern a company by its normalized name, returning the id.

        This is the join point for requirement (e). Without interning, "Acme Agri
        Pvt Ltd" and "Acme Agri" are two companies and each could be approved
        once — which is precisely the loophole the client wants closed.
        """
        if not name or not name.strip():
            raise ValueError("Company name is required")

        normalized = normalize_company_name(name)

        async with self._sessions() as session:
            existing = (
                await session.execute(
                    select(Company).where(Company.name_normalized == normalized)
                )
            ).scalar_one_or_none()

            if existing:
                # Backfill contact details we may not have had the first time.
                for key, value in extra.items():
                    if value and hasattr(existing, key) and not getattr(existing, key):
                        setattr(existing, key, value)
                await session.commit()
                return existing.id

            company_id = str(uuid.uuid4())
            session.add(
                Company(
                    id=company_id,
                    name=name.strip(),
                    name_normalized=normalized,
                    website=extra.get("website"),
                    contact_email=extra.get("contact_email"),
                )
            )
            await session.commit()

        logger.info("company_created", company_id=company_id, name=name)
        return company_id

    # ------------------------------------------------------------------
    # Categories (not predefined — minted on first sight)
    # ------------------------------------------------------------------

    async def upsert_category(
        self,
        label: str,
        *,
        description: Optional[str] = None,
        from_proposal_id: Optional[str] = None,
    ) -> str:
        """
        Intern a category by slug, minting it if this is the first idea to use it.

        The taxonomy is not fixed up front — the client was explicit that
        categories are not predefined. So the set of categories is whatever the
        submitted ideas turn out to be about, discovered as they arrive and
        interned here so that counting per category stays a GROUP BY.
        """
        slug = slugify(label)

        async with self._sessions() as session:
            existing = (
                await session.execute(select(Category).where(Category.slug == slug))
            ).scalar_one_or_none()

            if existing:
                return existing.id

            category_id = str(uuid.uuid4())
            session.add(
                Category(
                    id=category_id,
                    slug=slug,
                    label=label.strip(),
                    description=description,
                    created_from_proposal_id=from_proposal_id,
                )
            )
            await session.commit()

        logger.info("category_minted", category_id=category_id, slug=slug)
        return category_id

    async def list_categories(self) -> list[dict]:
        async with self._sessions() as session:
            rows = (
                (await session.execute(select(Category).order_by(Category.label)))
                .scalars()
                .all()
            )
            return [
                {
                    "id": c.id,
                    "slug": c.slug,
                    "label": c.label,
                    "description": c.description,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                }
                for c in rows
            ]

    # ------------------------------------------------------------------
    # Decisions — the append-only ledger
    # ------------------------------------------------------------------

    async def record_decision(
        self,
        *,
        proposal_id: str,
        decision: str,
        evaluation_id: Optional[str] = None,
        category_id: Optional[str] = None,
        company_id: Optional[str] = None,
        decided_by: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> str:
        """
        Append a decision.

        `category_id`/`company_id` are frozen onto the row at decision time rather
        than read through the proposal at query time. If an idea is later
        recategorised, last March's approval counts must not silently move to a
        different category — the historical record is what it is.
        """
        decision_id = str(uuid.uuid4())
        now = _utcnow()

        async with self._sessions() as session:
            # Fall back to the proposal's current dimensions if the caller did not
            # pin them explicitly.
            if category_id is None or company_id is None:
                proposal = (
                    await session.execute(
                        select(Proposal).where(Proposal.id == proposal_id)
                    )
                ).scalar_one_or_none()
                if proposal:
                    category_id = category_id or proposal.category_id
                    company_id = company_id or proposal.company_id

            session.add(
                Decision(
                    id=decision_id,
                    proposal_id=proposal_id,
                    evaluation_id=evaluation_id,
                    decision=decision,
                    category_id=category_id,
                    company_id=company_id,
                    decided_by=decided_by,
                    notes=notes,
                    decided_at=now,
                    decision_year=now.year,
                    decision_month=now.month,
                )
            )
            await session.commit()

        logger.info(
            "decision_recorded",
            proposal_id=proposal_id,
            decision=decision,
            decided_by=decided_by,
        )
        return decision_id

    async def latest_decision(self, proposal_id: str) -> Optional[dict]:
        """The current standing of an idea, i.e. the most recent entry."""
        async with self._sessions() as session:
            row = (
                await session.execute(
                    select(Decision)
                    .where(Decision.proposal_id == proposal_id)
                    .order_by(Decision.decided_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()

            if not row:
                return None
            return {
                "id": row.id,
                "decision": row.decision,
                "notes": row.notes,
                "decided_by": row.decided_by,
                "decided_at": row.decided_at.isoformat() if row.decided_at else None,
            }

    # ------------------------------------------------------------------
    # (d) Approvals per category
    # ------------------------------------------------------------------

    async def approvals_by_category(
        self, *, year: Optional[int] = None
    ) -> list[dict]:
        """
        How many ideas are approved in each category.

        This is the number an evaluator checks before approving another idea in a
        category that already has one — the "avoid approving ideas in the same
        category" requirement. Counts DISTINCT proposals, not decision rows, so an
        idea approved, unselected and re-approved still counts once.
        """
        async with self._sessions() as session:
            query = (
                select(
                    Category.id,
                    Category.slug,
                    Category.label,
                    func.count(func.distinct(Decision.proposal_id)).label("approved"),
                )
                .join(Decision, Decision.category_id == Category.id)
                .where(Decision.decision.in_(("approved", "selected_for_funding")))
                .group_by(Category.id, Category.slug, Category.label)
                .order_by(func.count(func.distinct(Decision.proposal_id)).desc())
            )
            if year:
                query = query.where(Decision.decision_year == year)

            rows = (await session.execute(query)).all()

            return [
                {
                    "category_id": cid,
                    "slug": slug,
                    "label": label,
                    "approved_count": approved,
                }
                for cid, slug, label, approved in rows
            ]

    # ------------------------------------------------------------------
    # (e) Approvals per company
    # ------------------------------------------------------------------

    async def approvals_by_company(
        self, *, year: Optional[int] = None
    ) -> list[dict]:
        """
        How many ideas each company has already had approved, and across how many
        distinct categories.

        `categories_spanned > 1` is the exact signal the client asked for: the
        same company winning in more than one domain. Surfacing it is what lets an
        evaluator prevent a single company taking a slot in every section.
        """
        async with self._sessions() as session:
            query = (
                select(
                    Company.id,
                    Company.name,
                    func.count(func.distinct(Decision.proposal_id)).label("approved"),
                    func.count(func.distinct(Decision.category_id)).label("categories"),
                )
                .join(Decision, Decision.company_id == Company.id)
                .where(Decision.decision.in_(("approved", "selected_for_funding")))
                .group_by(Company.id, Company.name)
                .order_by(func.count(func.distinct(Decision.proposal_id)).desc())
            )
            if year:
                query = query.where(Decision.decision_year == year)

            rows = (await session.execute(query)).all()

            return [
                {
                    "company_id": cid,
                    "name": name,
                    "approved_count": approved,
                    "categories_spanned": categories,
                    # The flag the dashboard highlights.
                    "multi_category": categories > 1,
                }
                for cid, name, approved, categories in rows
            ]

    async def company_approval_context(self, company_id: str) -> dict:
        """
        Everything an evaluator should know about this company before approving
        another of its ideas — shown inline on the proposal detail page.
        """
        async with self._sessions() as session:
            rows = (
                await session.execute(
                    select(
                        Decision.decision,
                        Decision.decision_year,
                        Decision.decision_month,
                        Category.label,
                        Proposal.id,
                        Proposal.title,
                    )
                    .join(Proposal, Proposal.id == Decision.proposal_id)
                    .outerjoin(Category, Category.id == Decision.category_id)
                    .where(
                        Decision.company_id == company_id,
                        Decision.decision.in_(("approved", "selected_for_funding")),
                    )
                    .order_by(Decision.decided_at.desc())
                )
            ).all()

            approvals = [
                {
                    "proposal_id": pid,
                    "title": title,
                    "category": label,
                    "decision": decision,
                    "year": year,
                    "month": month,
                }
                for decision, year, month, label, pid, title in rows
            ]

            return {
                "company_id": company_id,
                "approved_count": len({a["proposal_id"] for a in approvals}),
                "categories_spanned": len({a["category"] for a in approvals if a["category"]}),
                "approvals": approvals,
            }

    # ------------------------------------------------------------------
    # (f) Timeline
    # ------------------------------------------------------------------

    async def approval_timeline(
        self,
        *,
        year: Optional[int] = None,
        group_by: str = "category",
    ) -> list[dict]:
        """
        Approvals bucketed by year+month, optionally broken down by category or
        company.

        The year/month columns are denormalized on the decision row, so this is an
        indexed GROUP BY rather than a date-truncation over the whole table — which
        matters once the archive holds several years of submissions.
        """
        dimension = Category.label if group_by == "category" else Company.name
        join_target = Category if group_by == "category" else Company
        join_key = (
            Decision.category_id == Category.id
            if group_by == "category"
            else Decision.company_id == Company.id
        )

        async with self._sessions() as session:
            query = (
                select(
                    Decision.decision_year,
                    Decision.decision_month,
                    dimension.label("dimension"),
                    func.count(func.distinct(Decision.proposal_id)).label("approved"),
                )
                .outerjoin(join_target, join_key)
                .where(Decision.decision.in_(("approved", "selected_for_funding")))
                .group_by(Decision.decision_year, Decision.decision_month, dimension)
                .order_by(Decision.decision_year, Decision.decision_month)
            )
            if year:
                query = query.where(Decision.decision_year == year)

            rows = (await session.execute(query)).all()

            return [
                {
                    "year": y,
                    "month": m,
                    "period": f"{y}-{m:02d}",
                    group_by: dim or "Uncategorized",
                    "approved_count": count,
                }
                for y, m, dim, count in rows
            ]

    # ------------------------------------------------------------------
    # Audit
    # ------------------------------------------------------------------

    async def audit(
        self,
        *,
        action: str,
        entity_type: str,
        entity_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        payload: Optional[dict] = None,
    ) -> None:
        """Append-only. Never raises into the caller — an audit write must not
        be able to fail the operation it is recording."""
        try:
            async with self._sessions() as session:
                session.add(
                    AuditLog(
                        id=str(uuid.uuid4()),
                        actor_id=actor_id,
                        action=action,
                        entity_type=entity_type,
                        entity_id=entity_id,
                        payload=payload,
                    )
                )
                await session.commit()
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("audit_write_failed", action=action, error=str(exc))


_registry: Optional[RegistryRepository] = None


def get_registry_repository() -> RegistryRepository:
    global _registry
    if _registry is None:
        _registry = RegistryRepository()
    return _registry


def reset_registry_repository() -> None:
    """Used by tests."""
    global _registry
    _registry = None
