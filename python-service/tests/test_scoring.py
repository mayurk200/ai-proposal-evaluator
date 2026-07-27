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
        weighted, coverage, unevidenced, _failed = sa._weighted_score(breakdown)

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
        weighted, _coverage, unevidenced, _failed = sa._weighted_score(breakdown)

        # Both scored parameters are 80, so the renormalized mean is exactly 80 —
        # NOT 80 * (0.35/0.40) = 70, which is what counting compliance as zero gives.
        assert weighted == 80.0
        assert "Compliance & Governance" in unevidenced

    def test_no_scores_at_all_yields_zero_and_reports_everything_unevidenced(self):
        sa = ScoringAgent()
        results = {"compliance": agent_result("compliance", None, evidenced=False)}
        breakdown = sa._build_breakdown(results)
        weighted, coverage, unevidenced, _failed = sa._weighted_score(breakdown)

        assert weighted == 0.0
        assert coverage == 0.0
        assert unevidenced == ["Compliance & Governance"]


class TestFailedIsNotUnevidenced:
    """
    The distinction that matters most in the whole scoring path.

    A parameter our agent failed to assess (rate limit, timeout) must NEVER be reported
    as "the proposal did not address this". One is a fact about our infrastructure; the
    other is a finding against the applicant. Conflating them means an applicant loses a
    parameter — and possibly a funding decision — because we hit a 429.

    This is not hypothetical: it happened on a live run, where a Groq daily-token limit
    knocked out two agents and the report told the evaluator the proposal was silent on
    business model and farmer adoption. It was not.
    """

    def test_failed_agent_is_reported_separately_from_a_silent_proposal(self):
        sa = ScoringAgent()

        silent = agent_result("compliance", None, evidenced=False)  # proposal says nothing

        broken = agent_result("scaleup", None, evidenced=False)     # OUR agent died
        broken.status = "failed"
        broken.error = "Error code: 429 - rate limit reached"

        results = {
            "problem_relevance": agent_result("problem_relevance", 80.0),
            "compliance": silent,
            "scaleup": broken,
        }

        breakdown = sa._build_breakdown(results)
        weighted, coverage, unevidenced, failed = sa._weighted_score(breakdown)

        assert breakdown["compliance"].status == "unevidenced"
        assert breakdown["scaleup"].status == "failed"

        assert unevidenced == ["Compliance & Governance"]
        assert failed == ["Business Model & Scale-up"]

        # The failed one must not leak into the applicant-facing gap list.
        assert "Business Model & Scale-up" not in unevidenced

    def test_a_failed_parameter_does_not_drag_the_score_down(self):
        sa = ScoringAgent()

        broken = agent_result("scaleup", None, evidenced=False)
        broken.status = "failed"

        results = {
            "problem_relevance": agent_result("problem_relevance", 80.0),
            "solution_readiness": agent_result("solution_readiness", 80.0),
            "scaleup": broken,
        }
        breakdown = sa._build_breakdown(results)
        weighted, _, _, _ = sa._weighted_score(breakdown)

        # Both assessed parameters scored 80, so the renormalized mean is 80. The agent we
        # broke contributes nothing rather than a zero.
        assert weighted == 80.0

    def test_coverage_ignores_parameters_we_never_managed_to_ask_about(self):
        """
        Evidence coverage measures how much of the DOCUMENT answered our questions. A
        question we never got to ask cannot count against the document.
        """
        sa = ScoringAgent()

        broken = agent_result("scaleup", None, evidenced=False)
        broken.status = "failed"

        results = {
            "problem_relevance": agent_result("problem_relevance", 80.0),  # 1/1 evidenced
            "scaleup": broken,                                             # never asked
        }
        breakdown = sa._build_breakdown(results)
        _, coverage, _, _ = sa._weighted_score(breakdown)

        assert coverage == 1.0, "the failed agent's questions must not dilute coverage"

    def test_blind_context_tells_the_model_not_to_punish_the_applicant(self):
        sa = ScoringAgent()

        broken = agent_result("scaleup", None, evidenced=False)
        broken.status = "failed"

        breakdown = sa._build_breakdown({"scaleup": broken})
        blind = sa._render_blind_context(
            breakdown, 0.0, 0.0, [], ["Business Model & Scale-up"], None
        )

        assert "NOT ASSESSED" in blind
        assert "NOT a gap in the proposal" in blind
        assert "Do not penalise the applicant" in blind

    def test_evaluation_flags_itself_as_partial(self):
        from app.models.schemas import FinalEvaluation

        partial = FinalEvaluation(failed_parameters=["Business Model & Scale-up"])
        complete = FinalEvaluation(unevidenced_parameters=["Compliance & Governance"])

        assert partial.is_partial is True
        # A proposal that is merely silent on something is still a COMPLETE assessment.
        assert complete.is_partial is False


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
        blind = sa._render_blind_context(breakdown, 84.0, 1.0, [], [], None)

        assert "Business Model & Scale-up" in blind
        assert "84.0" in blind
        assert "a grounded quote from the document" in blind

    def test_unevidenced_parameter_is_labelled_not_silently_zeroed(self):
        sa = ScoringAgent()
        results = {"compliance": agent_result("compliance", None, evidenced=False)}
        breakdown = sa._build_breakdown(results)
        blind = sa._render_blind_context(
            breakdown, 0.0, 0.0, ["Compliance & Governance"], [], None
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
