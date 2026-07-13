"""
Approval decisions, and the guardrails around them.

Requirements (d) and (e) are not merely reporting requirements. The client's point is
to *prevent* two things happening by accident:

    (d) "we should avoid giving or approving ideas in same category"
    (e) "so if same company is pitching ideas in different domain can be identified
         and we can prevent single company in each section"

Reporting the counts on a dashboard the evaluator may not have open does not prevent
anything. So the check happens at the moment of decision: approving an idea into a
category that already has an approval — or from a company that has already won
elsewhere — is refused, and returns the specific conflict.

It is refused, not forbidden. There are legitimate reasons to approve a second idea in
a category (two genuinely different approaches to a big problem), and a rule that
cannot be overridden gets worked around rather than followed. So the evaluator can
proceed by acknowledging the conflict explicitly, and the override is recorded in the
audit log with their name on it. The default is safe; the exception is deliberate and
attributable.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.database.proposal_repository import get_proposal_repository
from app.services.database.registry_repository import get_registry_repository
from app.services.database.repository import get_repository
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Decisions that count as "this idea won a slot".
APPROVING = ("approved", "selected_for_funding")

VALID_DECISIONS = ("approved", "rejected", "selected_for_funding", "unselected")


class DecisionError(RuntimeError):
    """The decision cannot be recorded as asked."""


class DecisionConflict(RuntimeError):
    """
    The decision is allowed, but it collides with an existing approval.

    Carries the detail so the UI can show the evaluator exactly what they are about to
    do — which other idea already holds this category, or what else this company has
    already won — rather than a bare "are you sure?".
    """

    def __init__(self, message: str, conflicts: list[dict]):
        super().__init__(message)
        self.conflicts = conflicts


class DecisionService:
    def __init__(self) -> None:
        self.proposals = get_proposal_repository()
        self.evaluations = get_repository()
        self.registry = get_registry_repository()

    # ------------------------------------------------------------------
    # Conflict detection
    # ------------------------------------------------------------------

    async def check_conflicts(self, proposal_id: str) -> list[dict]:
        """
        What would collide if this idea were approved right now.

        Read-only — the UI calls this to warn *before* the evaluator clicks, so the
        conflict is information rather than an error message after the fact.
        """
        proposal = await self.proposals.get(proposal_id)
        if not proposal:
            raise DecisionError(f"Proposal {proposal_id} not found")

        conflicts: list[dict] = []

        # (d) Does this category already have an approved idea?
        if proposal.get("category_id"):
            by_category = await self.registry.approvals_by_category()
            existing = next(
                (c for c in by_category if c["category_id"] == proposal["category_id"]),
                None,
            )
            if existing and existing["approved_count"] > 0:
                conflicts.append(
                    {
                        "type": "category_already_approved",
                        "severity": "warning",
                        "category": existing["label"],
                        "approved_count": existing["approved_count"],
                        "message": (
                            f"{existing['approved_count']} idea(s) in "
                            f"\"{existing['label']}\" have already been approved. "
                            "Approving another concentrates funding in one category."
                        ),
                    }
                )

        # (e) Has this company already won something — in any category?
        if proposal.get("company_id"):
            context = await self.registry.company_approval_context(proposal["company_id"])
            if context["approved_count"] > 0:
                conflicts.append(
                    {
                        "type": "company_already_approved",
                        "severity": "warning",
                        "company": proposal.get("company_name"),
                        "approved_count": context["approved_count"],
                        "categories_spanned": context["categories_spanned"],
                        "existing_approvals": context["approvals"],
                        "message": (
                            f"{proposal.get('company_name')} already has "
                            f"{context['approved_count']} approved idea(s) across "
                            f"{context['categories_spanned']} categor"
                            f"{'ies' if context['categories_spanned'] != 1 else 'y'}. "
                            "Approving this one gives a single company another slot."
                        ),
                    }
                )

        return conflicts

    # ------------------------------------------------------------------
    # Recording a decision
    # ------------------------------------------------------------------

    async def decide(
        self,
        proposal_id: str,
        *,
        decision: str,
        decided_by: Optional[str],
        notes: Optional[str] = None,
        acknowledge_conflicts: bool = False,
    ) -> dict[str, Any]:
        """
        Record an approval, rejection, funding selection or de-selection.

        Approving raises DecisionConflict if it would collide with an existing approval,
        unless the caller has explicitly acknowledged the conflict.
        """
        if decision not in VALID_DECISIONS:
            raise DecisionError(
                f"Unknown decision '{decision}'. Expected one of: {', '.join(VALID_DECISIONS)}"
            )

        proposal = await self.proposals.get(proposal_id)
        if not proposal:
            raise DecisionError(f"Proposal {proposal_id} not found")

        # An idea cannot be approved on the strength of an evaluation it never had.
        # Rejection is allowed without one — an evaluator may reject a proposal on
        # sight, and forcing them to pay for a full agent pipeline first would be
        # perverse.
        if decision in APPROVING and not proposal["is_evaluated"]:
            raise DecisionError(
                "This idea has not been evaluated yet. Evaluate it before approving it."
            )

        conflicts: list[dict] = []
        if decision in APPROVING:
            conflicts = await self.check_conflicts(proposal_id)
            if conflicts and not acknowledge_conflicts:
                raise DecisionConflict(
                    "This approval conflicts with existing approvals. Review them and "
                    "resubmit with acknowledge_conflicts=true to proceed anyway.",
                    conflicts,
                )

        evaluation = await self.evaluations.get_latest_for_proposal(proposal_id)

        decision_id = await self.registry.record_decision(
            proposal_id=proposal_id,
            decision=decision,
            evaluation_id=evaluation["id"] if evaluation else None,
            # Pinned at decision time — see Decision's docstring. If the idea is
            # recategorised later, this month's approval counts must not move.
            category_id=proposal.get("category_id"),
            company_id=proposal.get("company_id"),
            decided_by=decided_by,
            notes=notes,
        )

        await self.registry.audit(
            action=f"decision_{decision}",
            entity_type="proposal",
            entity_id=proposal_id,
            actor_id=decided_by,
            payload={
                "decision_id": decision_id,
                "notes": notes,
                # If they overrode a conflict, that is exactly the thing an auditor
                # will want to find later.
                "overrode_conflicts": [c["type"] for c in conflicts] if conflicts else [],
            },
        )

        logger.info(
            "decision_recorded",
            proposal_id=proposal_id,
            decision=decision,
            decided_by=decided_by,
            overrode=len(conflicts),
        )

        return {
            "decision_id": decision_id,
            "proposal_id": proposal_id,
            "decision": decision,
            "overrode_conflicts": conflicts,
        }

    async def mark_for_funding(
        self,
        proposal_id: str,
        *,
        selected: bool,
        decided_by: Optional[str],
        notes: Optional[str] = None,
        acknowledge_conflicts: bool = False,
    ) -> dict[str, Any]:
        """
        Mark (or unmark) an idea as selected for funding.

        "If an idea is selected for funding by the evaluator then he should be able to
        mark it." Selecting is an approving decision and goes through the same
        guardrail; unselecting never conflicts with anything.
        """
        return await self.decide(
            proposal_id,
            decision="selected_for_funding" if selected else "unselected",
            decided_by=decided_by,
            notes=notes,
            acknowledge_conflicts=acknowledge_conflicts,
        )


_service: Optional[DecisionService] = None


def get_decision_service() -> DecisionService:
    global _service
    if _service is None:
        _service = DecisionService()
    return _service
