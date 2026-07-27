"""
The evidence rules — requirement (b): every score must cite its basis.

These are the invariants that make a score auditable. If any of them regress, the
system goes back to producing numbers nobody can defend to an applicant.
"""

import pytest

from app.agents.base_agent import BaseAgent
from app.models.schemas import Citation, SubQuestionResult


class DummyAgent(BaseAgent):
    name = "DummyAgent"
    parameter_key = "problem_relevance"
    parameter_label = "Problem & Relevance"
    sections = ("problem", "vision")
    questions = (
        ("q1", "Is the problem defined?"),
        ("q2", "Is it quantified?"),
    )
    role_prompt = "Test agent."


SOURCE = (
    "=== SECTION: problem ===\n"
    "Smallholder farmers in Vidarbha lose 30% of their cotton crop to pink bollworm "
    "each season. Claims under traditional schemes take 90-120 days to settle."
)


class TestCitationVerification:
    """A quote the model made up must not be allowed to justify a score."""

    def test_grounded_quote_survives(self):
        agent = DummyAgent()
        citations = [Citation(quote="lose 30% of their cotton crop to pink bollworm")]
        assert agent._verify_citations(citations, SOURCE) == citations

    def test_fabricated_quote_is_dropped(self):
        agent = DummyAgent()
        # Plausible, well-formed, and nowhere in the document.
        citations = [Citation(quote="Our model achieves 94% accuracy across 12 districts")]
        assert agent._verify_citations(citations, SOURCE) == []

    def test_punctuation_normalisation_is_not_fabrication(self):
        """
        A model that straightens a curly quote or swaps an en-dash for a hyphen has not
        invented anything, and must not be punished for it.
        """
        agent = DummyAgent()
        citations = [Citation(quote="Claims under traditional schemes take 90–120 days")]
        assert len(agent._verify_citations(citations, SOURCE)) == 1

    def test_whitespace_differences_tolerated(self):
        agent = DummyAgent()
        citations = [Citation(quote="Smallholder   farmers  in Vidarbha")]
        assert len(agent._verify_citations(citations, SOURCE)) == 1

    def test_trivially_short_quote_rejected(self):
        """A one-word 'quote' is not evidence of anything."""
        agent = DummyAgent()
        parsed = agent._parse_citations([{"quote": "farmers"}])
        assert parsed == []


class TestScoreRequiresEvidence:
    def test_score_without_citation_is_downgraded_to_unevidenced(self):
        """
        The model claims 9/10 but supplies no quote. We do not trust the number —
        this is exactly what requirement (b) forbids.
        """
        agent = DummyAgent()
        raw = {
            "sub_questions": [
                {"question_id": "q1", "score": 9, "evidence_found": True, "citations": []}
            ]
        }
        results = agent._parse_sub_questions(raw, SOURCE)
        q1 = next(r for r in results if r.question_id == "q1")

        assert q1.evidence_found is False
        assert q1.score is None

    def test_score_with_fabricated_citation_is_downgraded(self):
        agent = DummyAgent()
        raw = {
            "sub_questions": [
                {
                    "question_id": "q1",
                    "score": 9,
                    "evidence_found": True,
                    "citations": [{"quote": "We deployed to 400,000 farmers in Punjab"}],
                }
            ]
        }
        results = agent._parse_sub_questions(raw, SOURCE)
        q1 = next(r for r in results if r.question_id == "q1")

        assert q1.evidence_found is False, "a fabricated quote must not support a score"
        assert q1.score is None

    def test_unanswered_question_is_null_not_zero(self):
        """
        The single most important distinction in the whole system: 'did not address it'
        is not the same finding as 'addressed it terribly'.
        """
        agent = DummyAgent()
        results = agent._parse_sub_questions({"sub_questions": []}, SOURCE)

        for r in results:
            assert r.score is None, "unevidenced must be None"
            assert r.score != 0.0, "unevidenced must NEVER be scored 0"
            assert r.evidence_found is False


class TestAggregation:
    def test_unevidenced_questions_are_skipped_not_zeroed(self):
        agent = DummyAgent()
        subs = [
            SubQuestionResult(question_id="q1", score=8.0, evidence_found=True),
            SubQuestionResult(question_id="q2", score=None, evidence_found=False),
        ]
        # Mean of the evidenced ones only: 8.0 -> 80.0. If the unevidenced one were
        # counted as zero we would get 40.0, and the applicant would be punished for a
        # question the document never had to answer.
        assert agent._aggregate(subs) == 80.0

    def test_no_evidence_at_all_means_no_score(self):
        agent = DummyAgent()
        subs = [
            SubQuestionResult(question_id="q1", score=None, evidence_found=False),
            SubQuestionResult(question_id="q2", score=None, evidence_found=False),
        ]
        assert agent._aggregate(subs) is None, "no evidence must yield no score, not 0"

    def test_scores_are_scaled_to_100(self):
        agent = DummyAgent()
        subs = [
            SubQuestionResult(question_id="q1", score=10.0, evidence_found=True),
            SubQuestionResult(question_id="q2", score=5.0, evidence_found=True),
        ]
        assert agent._aggregate(subs) == 75.0


class TestStarvation:
    @pytest.mark.asyncio
    async def test_agent_with_no_relevant_sections_does_not_invent_a_score(self):
        """
        The document contains nothing this agent could judge. It must say so and spend
        nothing — not receive a fallback slice of unrelated text and score confidently
        from it, which is what the old keyword filter did.
        """
        agent = DummyAgent()
        result = await agent.analyze({"financial": "Budget is 50 lakh."})

        assert result.starved is True
        assert result.score is None
        assert result.tokens_used == 0
        assert result.sections_seen == []
        assert all(sq.score is None for sq in result.sub_questions)


class TestSectionRouting:
    def test_agent_receives_only_its_declared_sections(self):
        agent = DummyAgent()
        context, used = agent.build_context(
            {
                "problem": "Farmers lose crops to pests.",
                "vision": "We aim to transform Indian agriculture.",
                "financial": "SECRET BUDGET NUMBERS",   # not declared by this agent
                "team": "SECRET TEAM DETAILS",          # not declared by this agent
            }
        )

        assert "problem" in used and "vision" in used
        assert "financial" not in used and "team" not in used
        assert "SECRET BUDGET" not in context
        assert "SECRET TEAM" not in context

    def test_missing_section_is_simply_absent(self):
        agent = DummyAgent()
        context, used = agent.build_context({"problem": "Pest damage is severe."})
        assert used == ["problem"]
        assert "Pest damage" in context
