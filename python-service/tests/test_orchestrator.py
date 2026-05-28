"""
Tests for app.agents.orchestrator — Pipeline flow, content building, final evaluation.
All agent calls are mocked.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.agents.orchestrator import AgentOrchestrator
from app.models.schemas import (
    AgentResult,
    DocumentChunk,
    DocumentMetadata,
    FinalEvaluation,
)
from app.models.enums import ChunkPosition, ChunkType
from tests.conftest import make_chunk, make_metadata, make_agent_result


# ---------------------------------------------------------------------------
# Helper: create an orchestrator where every agent.analyze is an AsyncMock
# ---------------------------------------------------------------------------

def _make_mock_orchestrator() -> AgentOrchestrator:
    """Create orchestrator with all agents mocked."""
    orch = AgentOrchestrator.__new__(AgentOrchestrator)

    agents = [
        "extraction_agent", "problem_relevance_agent", "technical_agent",
        "pilot_design_agent", "team_agent", "market_agent",
        "financial_agent", "strategic_impact_agent", "scoring_agent",
    ]

    for attr in agents:
        mock_agent = MagicMock()
        mock_agent.name = attr.replace("_agent", "").title() + "Agent"

        # The scoring agent returns special keys
        if attr == "scoring_agent":
            mock_agent.analyze = AsyncMock(return_value=make_agent_result(
                name="FinalScoringAgent",
                score=65.0,
            ))
            mock_agent.analyze.return_value.raw_output = {
                "overall_score": 65,
                "problem_relevance_score": 70,
                "technical_soundness_score": 75,
                "pilot_design_score": 65,
                "team_capability_score": 80,
                "market_potential_score": 60,
                "financial_sustainability_score": 50,
                "strategic_impact_score": 60,
                "recommendation": "Conditionally Recommended",
                "summary": "The proposal shows promise but has gaps.",
                "strengths": ["Strong tech team"],
                "weaknesses": ["Weak financials"],
                "swot_analysis": {
                    "strengths": ["Tech"],
                    "weaknesses": ["Financials"],
                    "opportunities": ["Market growth"],
                    "threats": ["Competition"],
                },
                "key_points": ["Key point 1"],
                "invalid_claims": [],
                "investment_readiness": "Needs Work",
                "key_action_items": ["Improve unit economics"],
                "risk_level": "Medium",
                "confidence": 0.85,
            }
        else:
            mock_agent.analyze = AsyncMock(return_value=make_agent_result(
                name=mock_agent.name,
                score=70.0,
            ))

        setattr(orch, attr, mock_agent)

    return orch


# ============================================================================
# _build_content
# ============================================================================

class TestBuildContent:
    def test_includes_summary(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        chunks = [make_chunk(text="chunk text", section_title="Intro")]
        content = orch._build_content(chunks, summary="Executive summary here.")
        assert "EXECUTIVE SUMMARY" in content
        assert "Executive summary here." in content
        assert "chunk text" in content

    def test_no_summary(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        chunks = [make_chunk(text="chunk text")]
        content = orch._build_content(chunks, summary="")
        assert "EXECUTIVE SUMMARY" not in content
        assert "chunk text" in content

    def test_section_headers_included(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        chunks = [make_chunk(section_title="Financial Data", page_numbers=[3, 4])]
        content = orch._build_content(chunks)
        assert "Financial Data" in content
        assert "3, 4" in content

    def test_empty_chunks(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        content = orch._build_content([], summary="summary")
        assert "summary" in content


# ============================================================================
# _build_final_evaluation
# ============================================================================

class TestBuildFinalEvaluation:
    def test_maps_scoring_output(self):
        orch = _make_mock_orchestrator()
        scoring_result = orch.scoring_agent.analyze.return_value

        agent_results = {
            "extraction": make_agent_result("ExtractionAgent", 75),
            "problem_relevance": make_agent_result("ProblemRelevanceAgent", 70),
            "technical": make_agent_result("TechnicalAgent", 75),
            "pilot_design": make_agent_result("PilotDesignAgent", 65),
            "team": make_agent_result("TeamAgent", 80),
            "market": make_agent_result("MarketAgent", 60),
            "financial": make_agent_result("FinancialAgent", 50),
            "strategic_impact": make_agent_result("StrategicImpactAgent", 60),
            "scoring": scoring_result,
        }

        final = orch._build_final_evaluation(scoring_result, agent_results)

        assert isinstance(final, FinalEvaluation)
        assert final.overall_score == 67.75
        assert final.recommendation == "Reject"
        assert final.risk_level == "Medium"
        assert "Tech" in final.swot_analysis.strengths
        assert "Competition" in final.swot_analysis.threats

    def test_fallback_to_agent_scores(self):
        orch = _make_mock_orchestrator()
        scoring_result = make_agent_result("FinalScoringAgent", 60)
        scoring_result.raw_output = {}  # Empty raw output

        agent_results = {
            "problem_relevance": make_agent_result("ProblemRelevanceAgent", 70),
            "financial": make_agent_result("FinancialAgent", 50),
            "scoring": scoring_result,
        }

        final = orch._build_final_evaluation(scoring_result, agent_results)
        # Should fall back to individual agent scores
        assert final.problem_relevance_score == 70.0
        assert final.financial_sustainability_score == 50.0


# ============================================================================
# evaluate (full pipeline)
# ============================================================================

class TestEvaluate:
    @pytest.mark.asyncio
    async def test_full_pipeline(self):
        orch = _make_mock_orchestrator()

        chunks = [
            make_chunk("Problem statement text.", "Problem", [1], position=ChunkPosition.START),
            make_chunk("Financial projections.", "Financials", [2], has_financial=True),
            make_chunk("Technical details.", "Technical", [3], has_technical=True, position=ChunkPosition.END),
        ]
        metadata = make_metadata()

        result = await orch.evaluate(chunks, metadata, summary="Summary text.")

        assert "agent_results" in result
        assert "final_evaluation" in result
        assert "total_tokens" in result
        assert "total_time_seconds" in result

        # All 9 agents should have been called
        assert orch.extraction_agent.analyze.called
        assert orch.problem_relevance_agent.analyze.called
        assert orch.technical_agent.analyze.called
        assert orch.pilot_design_agent.analyze.called
        assert orch.team_agent.analyze.called
        assert orch.market_agent.analyze.called
        assert orch.financial_agent.analyze.called
        assert orch.strategic_impact_agent.analyze.called
        assert orch.scoring_agent.analyze.called

    @pytest.mark.asyncio
    async def test_pipeline_collects_all_results(self):
        orch = _make_mock_orchestrator()
        chunks = [make_chunk()]
        metadata = make_metadata()

        result = await orch.evaluate(chunks, metadata)

        agent_keys = set(result["agent_results"].keys())
        expected_keys = {
            "extraction", "problem_relevance", "technical", "pilot_design",
            "team", "market", "financial", "strategic_impact", "scoring",
        }
        assert agent_keys == expected_keys

    @pytest.mark.asyncio
    async def test_total_tokens_summed(self):
        orch = _make_mock_orchestrator()
        chunks = [make_chunk()]
        metadata = make_metadata()

        result = await orch.evaluate(chunks, metadata)

        # Each mock agent returns 500 tokens, 9 agents = 4500
        assert result["total_tokens"] == 500 * 9
