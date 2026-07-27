"""
Approval guardrails — requirements (d) and (e) as *prevention*, not just reporting.

The client does not want a dashboard that shows, after the fact, that two ideas in one
category were funded. They want that not to happen by accident. So the check lives at
the moment of decision, and these tests pin that behaviour.
"""

import pytest

from app.services.processing.decision_service import (
    APPROVING,
    VALID_DECISIONS,
    DecisionConflict,
)


class TestDecisionVocabulary:
    def test_approving_decisions_are_the_ones_that_win_a_slot(self):
        assert set(APPROVING) == {"approved", "selected_for_funding"}

    def test_rejection_and_deselection_are_not_approvals(self):
        # A rejected idea must never appear in the per-category or per-company counts.
        assert "rejected" not in APPROVING
        assert "unselected" not in APPROVING

    def test_every_approving_decision_is_a_valid_decision(self):
        assert set(APPROVING).issubset(set(VALID_DECISIONS))


class TestDecisionConflict:
    def test_conflict_carries_the_detail_the_evaluator_needs(self):
        """
        A bare "are you sure?" is useless. The evaluator has to see WHICH idea already
        holds the category, and what else the company has already won, or they cannot
        make the call.
        """
        conflicts = [
            {
                "type": "category_already_approved",
                "category": "Precision Irrigation",
                "approved_count": 1,
                "message": "1 idea(s) in \"Precision Irrigation\" have already been approved.",
            }
        ]
        exc = DecisionConflict("conflicts found", conflicts)

        assert exc.conflicts == conflicts
        assert exc.conflicts[0]["category"] == "Precision Irrigation"


class TestPdfExport:
    def test_unevidenced_parameter_never_renders_as_zero(self):
        """
        A PDF is what gets handed to an applicant or an auditor. Printing "0.0" against a
        parameter the proposal never addressed would misrepresent a silent document as a
        bad one — permanently, in a file that outlives the conversation.
        """
        from app.services.reporting.pdf_exporter import format_score

        assert format_score(None) == "Not addressed"
        assert format_score(None) != "0.0"
        assert format_score(0.0) == "0.0", "a genuine zero is still a zero"
        assert format_score(85.0) == "85.0"

    def test_pdf_renders_end_to_end(self):
        from app.services.reporting.pdf_exporter import build_evaluation_pdf

        evaluation = {
            "id": "eval-1",
            "created_at": "2026-07-13T10:00:00",
            "report": {
                "evaluation": {
                    "overall_score": 80.0,
                    "recommendation": "Recommended",
                    "risk_level": "Low",
                    "evidence_coverage": 0.5,
                    "summary": "A summary.",
                    "unevidenced_parameters": ["Compliance & Governance"],
                    "swot_analysis": {"narrative": "A continuous assessment."},
                    "parameter_breakdown": {
                        "compliance": {
                            "parameter_name": "Compliance & Governance",
                            "parameter_key": "compliance",
                            "parameter_score": None,
                            "weight": 0.05,
                            "evidence_coverage": 0.0,
                            "sub_questions": [],
                        }
                    },
                }
            },
        }
        proposal = {
            "filename": "idea.pdf",
            "title": "An Idea",
            "company_name": "Acme",
            "category_label": "Irrigation",
        }

        pdf = build_evaluation_pdf(evaluation=evaluation, proposal=proposal)
        assert pdf.startswith(b"%PDF")
        assert len(pdf) > 2000

    def test_parameters_render_in_a_stable_order(self):
        """
        Agents complete concurrently, so dict order is really completion order. Without
        an explicit sort, the same proposal exported twice produced tables whose rows had
        moved. A funding record must not shuffle itself.
        """
        from app.services.reporting.pdf_exporter import _ordered_breakdown

        scrambled = {
            "compliance": {"parameter_name": "Compliance & Governance"},
            "problem_relevance": {"parameter_name": "Problem & Relevance"},
            "team_capacity": {"parameter_name": "Team & Capacity"},
        }
        ordered = list(_ordered_breakdown(scrambled))

        assert ordered.index("problem_relevance") < ordered.index("team_capacity")
        assert ordered.index("team_capacity") < ordered.index("compliance")
