"""
Company identity and the debate trigger.

`normalize_company_name` is what closes the loophole in requirement (e): a company
that pitches as "Acme Agri Pvt. Ltd." on one form and "ACME AGRI" on the next must be
counted as ONE company, or it can quietly win a slot in several categories.
"""

import pytest

from app.agents.debate_agent import DebateAgent
from app.models.schemas import AgentResult
from app.services.database.registry_repository import normalize_company_name, slugify


class TestCompanyIdentity:
    def test_spelling_variants_collapse_to_one_identity(self):
        variants = [
            "Acme Agri Pvt. Ltd.",
            "ACME AGRI",
            "Acme Agri Private Limited",
            "acme agri technologies",
            "Acme Agri Pvt Ltd.",
        ]
        identities = {normalize_company_name(v) for v in variants}
        assert len(identities) == 1, f"same company split across identities: {identities}"

    def test_different_companies_stay_different(self):
        assert normalize_company_name("Acme Agri") != normalize_company_name("Nova Krishi")

    def test_generic_name_does_not_collapse_to_empty(self):
        """
        A company literally called "Agritech Solutions" is all suffix. Stripping
        everything would leave "" and merge every such company into one row.
        """
        assert normalize_company_name("Agritech Solutions") != ""
        assert normalize_company_name("Technologies Pvt Ltd") != ""

    def test_normalization_is_stable(self):
        once = normalize_company_name("Dvara E-Registry Private Limited")
        assert normalize_company_name(once) == once


class TestSlugify:
    def test_slug_is_stable_across_casing_and_punctuation(self):
        assert slugify("Precision Irrigation") == slugify("precision irrigation")
        assert slugify("Crop Disease Detection!") == "crop-disease-detection"

    def test_empty_label_gets_a_fallback(self):
        assert slugify("") == "uncategorized"


def result(key: str, score, red_flags=None) -> AgentResult:
    return AgentResult(
        agent_name=key,
        parameter_key=key,
        score=score,
        red_flags=red_flags or [],
        status="success",
    )


class TestDebateTrigger:
    """
    The old should_trigger() ended with an unconditional `return True`, so every
    variance/conflict check above it was dead code and debate ran on every proposal —
    one large LLM call each time, always.
    """

    def test_consistent_assessment_does_not_trigger_debate(self):
        agent = DebateAgent()
        results = {
            "problem_relevance": result("problem_relevance", 72.0),
            "solution_readiness": result("solution_readiness", 68.0),
            "pilot_design": result("pilot_design", 70.0),
            "team_capacity": result("team_capacity", 75.0),
        }
        trigger, reasons = agent.should_trigger(results)

        assert trigger is False, "there is nothing to debate — the scores agree"
        assert reasons == []

    def test_wide_score_spread_triggers_debate(self):
        agent = DebateAgent()
        results = {
            "problem_relevance": result("problem_relevance", 90.0),
            "solution_readiness": result("solution_readiness", 85.0),
            "team_capacity": result("team_capacity", 20.0),
        }
        trigger, reasons = agent.should_trigger(results)

        assert trigger is True
        assert any("points apart" in r for r in reasons)

    def test_high_score_with_a_red_flag_triggers_debate(self):
        """The assessor found something alarming and scored around it anyway."""
        agent = DebateAgent()
        results = {
            "problem_relevance": result("problem_relevance", 70.0),
            "solution_readiness": result("solution_readiness", 72.0),
            "scaleup": result("scaleup", 85.0, red_flags=["No paying customers exist."]),
        }
        trigger, reasons = agent.should_trigger(results)

        assert trigger is True
        assert any("red flag" in r for r in reasons)

    def test_known_conflict_pair_triggers_debate(self):
        """Strong commercials, farmers who cannot afford it — the average hides this."""
        agent = DebateAgent()
        results = {
            "scaleup": result("scaleup", 88.0),
            "farmer_adoption": result("farmer_adoption", 55.0),
            "pilot_design": result("pilot_design", 70.0),
        }
        trigger, reasons = agent.should_trigger(results)

        assert trigger is True
        assert any("afford" in r for r in reasons)

    def test_too_few_scored_parameters_to_have_a_contradiction(self):
        agent = DebateAgent()
        results = {
            "scaleup": result("scaleup", 90.0),
            "team_capacity": result("team_capacity", 20.0),
        }
        trigger, _ = agent.should_trigger(results)
        assert trigger is False

    def test_failed_agents_are_not_treated_as_low_scores(self):
        agent = DebateAgent()
        failed = result("compliance", None)
        failed.status = "failed"

        results = {
            "problem_relevance": result("problem_relevance", 70.0),
            "solution_readiness": result("solution_readiness", 72.0),
            "pilot_design": result("pilot_design", 68.0),
            "compliance": failed,
        }
        trigger, _ = agent.should_trigger(results)

        # An agent that failed tells us nothing about the proposal, so it must not
        # manufacture a 70-point "spread" against the others.
        assert trigger is False
