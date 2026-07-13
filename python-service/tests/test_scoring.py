"""
Final scoring: deterministic weighting, the adjustment band, and the blind.
"""

from app.agents.scoring_agent import MAX_ADJUSTMENT, ScoringAgent
from app.models.schemas import AgentResult, Citation, SubQuestionResult


def agent_result(key: str, score, *, red_flags=None, evidenced=True) -> AgentResult:
    return AgentResult(
        agent_name=f"{key}Agent",
        parameter_key=key,
        score=score,
        red_flags=red_flags or [],
        sub_questions=[
            SubQuestionResult(
                question_id="q1",
                question="A question",
                score=(score / 10 if score is not None else None),
                evidence_found=evidenced and score is not None,
                citations=(
                    [Citation(quote="a grounded quote from the document", section=key)]
                    if evidenced and score is not None
                    else []
                ),
            )
        ],
    )


class TestWeighting:
    def test_weighted_mean_uses_official_weights(self):
        sa = ScoringAgent()
        results = {
            "problem_relevance": agent_result("problem_relevance", 80.0),   # 0.15
            "solution_readiness": agent_result("solution_readiness", 60.0), # 0.20
            "pilot_design": agent_result("pilot_design", 70.0),             # 0.20
            "farmer_adoption": agent_result("farmer_adoption", 50.0),       # 0.15
            "scaleup": agent_result("scaleup", 90.0),                       # 0.15
            "team_capacity": agent_result("team_capacity", 40.0),           # 0.10
            "compliance": agent_result("compliance", 100.0),                # 0.05
        }
        breakdown = sa._build_breakdown(results)
        weighted, coverage, unevidenced = sa._weighted_score(breakdown)

        expected = (
            80 * 0.15 + 60 * 0.20 + 70 * 0.20 + 50 * 0.15
            + 90 * 0.15 + 40 * 0.10 + 100 * 0.05
        )
        assert weighted == round(expected, 2)
        assert unevidenced == []
        assert coverage == 1.0

    def test_unscored_parameter_is_excluded_and_weights_renormalized(self):
        """
        A proposal that never mentions compliance (weight 5%) must not simply lose 5
        points. That would make the overall score a measure of how completely the form
        was filled in, rather than of the idea's merit. The gap is reported instead.
        """
        sa = ScoringAgent()
        results = {
            "problem_relevance": agent_result("problem_relevance", 80.0),
            "solution_readiness": agent_result("solution_readiness", 80.0),
            "compliance": agent_result("compliance", None, evidenced=False),
        }
        breakdown = sa._build_breakdown(results)
        weighted, _coverage, unevidenced = sa._weighted_score(breakdown)

        # Both scored parameters are 80, so the renormalized mean is exactly 80 —
        # NOT 80 * (0.35/0.40) = 70, which is what counting compliance as zero gives.
        assert weighted == 80.0
        assert "Compliance & Governance" in unevidenced

    def test_no_scores_at_all_yields_zero_and_reports_everything_unevidenced(self):
        sa = ScoringAgent()
        results = {"compliance": agent_result("compliance", None, evidenced=False)}
        breakdown = sa._build_breakdown(results)
        weighted, coverage, unevidenced = sa._weighted_score(breakdown)

        assert weighted == 0.0
        assert coverage == 0.0
        assert unevidenced == ["Compliance & Governance"]


class TestAdjustmentBand:
    def test_model_may_nudge_within_the_band(self):
        sa = ScoringAgent()
        assert sa._apply_adjustment(70.0, {"adjusted_score": 65.0}) == 65.0

    def test_adjustment_beyond_the_band_is_clamped(self):
        """
        Otherwise the deterministic weighting is decorative and the LLM is really the
        one scoring — which is exactly the non-reproducibility we removed.
        """
        sa = ScoringAgent()
        assert sa._apply_adjustment(70.0, {"adjusted_score": 30.0}) == 70.0 - MAX_ADJUSTMENT
        assert sa._apply_adjustment(70.0, {"adjusted_score": 99.0}) == 70.0 + MAX_ADJUSTMENT

    def test_garbage_adjustment_falls_back_to_the_computed_score(self):
        sa = ScoringAgent()
        assert sa._apply_adjustment(70.0, {"adjusted_score": "banana"}) == 70.0
        assert sa._apply_adjustment(70.0, {}) == 70.0

    def test_score_stays_in_range(self):
        sa = ScoringAgent()
        assert sa._apply_adjustment(3.0, {"adjusted_score": -50.0}) == 0.0
        assert sa._apply_adjustment(98.0, {"adjusted_score": 200.0}) == 100.0


class TestBlindSynthesis:
    def test_blind_context_contains_scores_and_evidence(self):
        sa = ScoringAgent()
        results = {"scaleup": agent_result("scaleup", 84.0)}
        breakdown = sa._build_breakdown(results)
        blind = sa._render_blind_context(breakdown, 84.0, 1.0, [], None)

        assert "Business Model & Scale-up" in blind
        assert "84.0" in blind
        assert "a grounded quote from the document" in blind

    def test_unevidenced_parameter_is_labelled_not_silently_zeroed(self):
        sa = ScoringAgent()
        results = {"compliance": agent_result("compliance", None, evidenced=False)}
        breakdown = sa._build_breakdown(results)
        blind = sa._render_blind_context(
            breakdown, 0.0, 0.0, ["Compliance & Governance"], None
        )

        assert "UNEVIDENCED" in blind
        assert "did NOT address" in blind

    def test_recommendation_falls_back_to_the_score_band(self):
        sa = ScoringAgent()
        assert sa._recommendation(None, 85.0) == "Highly Recommended"
        assert sa._recommendation(None, 70.0) == "Recommended"
        assert sa._recommendation(None, 50.0) == "Conditionally Recommended"
        assert sa._recommendation(None, 20.0) == "Not Recommended"
        # A value the model invented is rejected in favour of the band.
        assert sa._recommendation("Definitely Fund It", 20.0) == "Not Recommended"
