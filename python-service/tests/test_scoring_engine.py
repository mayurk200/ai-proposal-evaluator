"""
Tests for the deterministic scoring engine in the orchestrator.
Verifies weighted scoring, recommendation logic, risk levels,
confidence degradation, SWOT aggregation, and edge cases.
"""

import pytest
from app.agents.orchestrator import AgentOrchestrator, SCORING_WEIGHTS
from app.agents.validation import clamp_score, clamp_confidence
from app.models.schemas import AgentResult, DocumentMetadata, FinalEvaluation
from tests.conftest import make_agent_result, make_metadata


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _make_results(**score_overrides) -> dict[str, AgentResult]:
    """Create a full set of agent results with optional score overrides."""
    defaults = {
        "extraction": 80,
        "problem_relevance": 70,
        "technical": 75,
        "pilot_design": 65,
        "team": 80,
        "market": 60,
        "financial": 50,
        "strategic_impact": 60,
    }
    defaults.update(score_overrides)

    results = {}
    for key, score in defaults.items():
        result = make_agent_result(
            name=f"{key.title()}Agent",
            score=float(score),
        )
        result.red_flags = []  # Clear default red flags to prevent auto-rejects
        results[key] = result
    return results


# ============================================================================
# clamp_score / clamp_confidence
# ============================================================================

class TestClampScore:
    def test_normal_value(self):
        assert clamp_score(75.0) == 75.0

    def test_above_100(self):
        assert clamp_score(150.0) == 100.0

    def test_below_0(self):
        assert clamp_score(-10.0) == 0.0

    def test_string_value(self):
        assert clamp_score("85.5") == 85.5

    def test_none_value(self):
        assert clamp_score(None) == 0.0

    def test_garbage_string(self):
        assert clamp_score("not_a_number") == 0.0

    def test_boolean(self):
        assert clamp_score(True) == 1.0


class TestClampConfidence:
    def test_normal(self):
        assert clamp_confidence(0.85) == 0.85

    def test_above_1(self):
        assert clamp_confidence(1.5) == 1.0

    def test_below_0(self):
        assert clamp_confidence(-0.3) == 0.0


# ============================================================================
# Weighted Score Calculation
# ============================================================================

class TestWeightedScoring:
    def test_exact_weighted_average(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results()
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)

        # Manual calculation:
        # pr=70*0.20 + ts=75*0.20 + pd=65*0.15 + tc=80*0.15 + mp=60*0.10 + fs=50*0.10 + si=60*0.10
        # = 14 + 15 + 9.75 + 12 + 6 + 5 + 6 = 67.75
        assert final.overall_score == 67.75

    def test_all_zeros(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(
            problem_relevance=0, technical=0, pilot_design=0,
            team=0, market=0, financial=0, strategic_impact=0,
        )
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.overall_score == 0.0

    def test_all_100s(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(
            problem_relevance=100, technical=100, pilot_design=100,
            team=100, market=100, financial=100, strategic_impact=100,
        )
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.overall_score == 100.0

    def test_score_clamping_above_100(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(problem_relevance=150)
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        # 150 should be clamped to 100
        assert final.problem_relevance_score == 100.0

    def test_weights_sum_to_one(self):
        total = sum(SCORING_WEIGHTS.values())
        assert abs(total - 1.0) < 0.001


# ============================================================================
# Recommendation Logic
# ============================================================================

class TestRecommendation:
    def test_select_high_scores(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(
            problem_relevance=80, technical=80, pilot_design=75,
            team=80, market=70, financial=70, strategic_impact=70,
        )
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.recommendation == "Select"

    def test_reject_low_overall(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(
            problem_relevance=50, technical=50, pilot_design=50,
            team=50, market=50, financial=50, strategic_impact=50,
        )
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.recommendation == "Reject"

    def test_reject_one_agent_below_threshold(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(
            problem_relevance=90, technical=90, pilot_design=90,
            team=90, market=90, financial=30, strategic_impact=90,
        )
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        # financial=30 < MIN_AGENT_SCORE_THRESHOLD(40) → Reject
        assert final.recommendation == "Reject"

    def test_reject_many_red_flags(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(
            problem_relevance=80, technical=80, pilot_design=80,
            team=80, market=80, financial=80, strategic_impact=80,
        )
        # Add red flags to agents
        results["technical"].red_flags = ["flag1", "flag2", "flag3"]
        results["financial"].red_flags = ["flag4", "flag5"]
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.recommendation == "Reject"


# ============================================================================
# Risk Level
# ============================================================================

class TestRiskLevel:
    def test_low_risk(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(
            problem_relevance=80, technical=80, pilot_design=80,
            team=80, market=80, financial=80, strategic_impact=80,
        )
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.risk_level == "Low"

    def test_critical_risk_very_low_score(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(financial=10)
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.risk_level in ("Critical", "High")


# ============================================================================
# Investment Readiness
# ============================================================================

class TestInvestmentReadiness:
    def test_ready(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(
            problem_relevance=80, technical=80, pilot_design=80,
            team=80, market=80, financial=80, strategic_impact=80,
        )
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.investment_readiness == "Ready"

    def test_needs_work(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(
            problem_relevance=60, technical=60, pilot_design=50,
            team=55, market=50, financial=45, strategic_impact=55,
        )
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.investment_readiness == "Needs Work"

    def test_not_ready(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results(
            problem_relevance=30, technical=30, pilot_design=20,
            team=25, market=20, financial=15, strategic_impact=25,
        )
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.investment_readiness == "Not Ready"


# ============================================================================
# Confidence Degradation
# ============================================================================

class TestConfidence:
    def test_full_confidence_good_doc(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results()
        metadata = make_metadata(words=3000)

        confidence = orch._compute_confidence(results, metadata)
        assert confidence >= 0.8

    def test_degraded_for_low_ocr(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results()
        metadata = make_metadata(words=3000)
        metadata.ocr_confidence = 0.3

        confidence = orch._compute_confidence(results, metadata)
        assert confidence < 0.8

    def test_degraded_for_short_doc(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results()
        metadata = make_metadata(words=200)

        confidence = orch._compute_confidence(results, metadata)
        assert confidence < 0.7

    def test_degraded_for_failed_agent(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results()
        results["financial"] = AgentResult(
            agent_name="FinancialAgent", score=0, status="failed", error="timeout"
        )
        metadata = make_metadata()

        confidence = orch._compute_confidence(results, metadata)
        assert confidence < 0.9


# ============================================================================
# SWOT Aggregation
# ============================================================================

class TestSWOT:
    def test_aggregates_from_all_agents(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results()
        results["technical"].key_findings = ["Strong ML pipeline"]
        results["financial"].red_flags = ["Weak unit economics"]
        results["market"].recommendations = ["Expand to Gujarat"]

        swot = orch._aggregate_swot(results)

        assert "Strong ML pipeline" in swot.strengths
        assert "Weak unit economics" in swot.weaknesses
        assert "Expand to Gujarat" in swot.opportunities

    def test_empty_results(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = {}

        swot = orch._aggregate_swot(results)
        assert swot.strengths == []
        assert swot.weaknesses == []


# ============================================================================
# Fallback / Edge Cases
# ============================================================================

class TestEdgeCases:
    def test_missing_agent_defaults_to_zero(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        # Only provide some agents
        results = {
            "extraction": make_agent_result("ExtractionAgent", 80),
            "problem_relevance": make_agent_result("ProblemRelevanceAgent", 70),
        }
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        # Missing agents default to 0 score
        assert final.technical_soundness_score == 0.0
        assert final.overall_score > 0  # Should still compute partial score

    def test_all_agents_failed(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = {}
        for key in ["extraction", "problem_relevance", "technical", "pilot_design",
                     "team", "market", "financial", "strategic_impact"]:
            results[key] = AgentResult(
                agent_name=f"{key}Agent", score=0, status="failed", error="test"
            )
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert final.overall_score == 0.0
        assert final.recommendation == "Reject"
        assert final.risk_level == "Critical"

    def test_returns_final_evaluation_type(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        results = _make_results()
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)
        assert isinstance(final, FinalEvaluation)
