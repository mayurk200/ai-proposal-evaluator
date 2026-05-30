"""
Tests for app.agents.orchestrator — Pipeline flow, content building, final evaluation.
All agent calls are mocked. Scoring is now deterministic (no scoring agent).
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
    """Create orchestrator with all agents mocked (no scoring agent)."""
    orch = AgentOrchestrator.__new__(AgentOrchestrator)

    agents = [
        "extraction_agent", "problem_relevance_agent", "technical_agent",
        "pilot_design_agent", "team_agent", "market_agent",
        "financial_agent", "strategic_impact_agent",
    ]

    for attr in agents:
        mock_agent = MagicMock()
        mock_agent.name = attr.replace("_agent", "").title() + "Agent"
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
# _build_agent_context
# ============================================================================

class TestBuildAgentContext:
    def test_targeted_context(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        extracted = {
            "problem_statement": "Food waste in supply chains",
            "technology_used": ["IoT", "ML"],
            "founders": [{"name": "Test"}],
        }
        content = orch._build_agent_context("problem_relevance", extracted, "base text")
        assert "problem_statement" in content
        assert "base text" in content
        # Should NOT include team-only fields
        assert "founders" not in content

    def test_empty_extraction(self):
        orch = AgentOrchestrator.__new__(AgentOrchestrator)
        content = orch._build_agent_context("technical", {}, "base text")
        assert content == "base text"


# ============================================================================
# Deterministic evaluation
# ============================================================================

class TestDeterministicEvaluation:
    def test_maps_scores(self):
        orch = _make_mock_orchestrator()
        results = {
            "extraction": make_agent_result("ExtractionAgent", 75),
            "problem_relevance": make_agent_result("ProblemRelevanceAgent", 70),
            "technical": make_agent_result("TechnicalAgent", 75),
            "pilot_design": make_agent_result("PilotDesignAgent", 65),
            "team": make_agent_result("TeamAgent", 80),
            "market": make_agent_result("MarketAgent", 60),
            "financial": make_agent_result("FinancialAgent", 50),
            "strategic_impact": make_agent_result("StrategicImpactAgent", 60),
        }
        metadata = make_metadata()

        final = orch._compute_deterministic_evaluation(results, metadata)

        assert isinstance(final, FinalEvaluation)
        assert final.overall_score == 67.75
        assert final.recommendation == "Reject"  # Below 75
        assert final.risk_level in ("Low", "Medium", "High", "Critical")

    def test_recommendation_is_deterministic(self):
        """Same input always produces same recommendation."""
        orch = _make_mock_orchestrator()
        results = {
            "extraction": make_agent_result("ExtractionAgent", 80),
            "problem_relevance": make_agent_result("ProblemRelevanceAgent", 80),
            "technical": make_agent_result("TechnicalAgent", 80),
            "pilot_design": make_agent_result("PilotDesignAgent", 80),
            "team": make_agent_result("TeamAgent", 80),
            "market": make_agent_result("MarketAgent", 80),
            "financial": make_agent_result("FinancialAgent", 80),
            "strategic_impact": make_agent_result("StrategicImpactAgent", 80),
        }
        metadata = make_metadata()

        final1 = orch._compute_deterministic_evaluation(results, metadata)
        final2 = orch._compute_deterministic_evaluation(results, metadata)
        assert final1.recommendation == final2.recommendation
        assert final1.overall_score == final2.overall_score


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

        # 8 analysis agents should have been called (no scoring agent)
        assert orch.extraction_agent.analyze.called
        assert orch.problem_relevance_agent.analyze.called
        assert orch.technical_agent.analyze.called
        assert orch.pilot_design_agent.analyze.called
        assert orch.team_agent.analyze.called
        assert orch.market_agent.analyze.called
        assert orch.financial_agent.analyze.called
        assert orch.strategic_impact_agent.analyze.called

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
    async def test_scoring_key_is_deterministic(self):
        """The 'scoring' key should exist for backward compat and be deterministic."""
        orch = _make_mock_orchestrator()
        chunks = [make_chunk()]
        metadata = make_metadata()

        result = await orch.evaluate(chunks, metadata)

        scoring = result["agent_results"]["scoring"]
        assert scoring["agent_name"] == "DeterministicScoringEngine"
        assert scoring["status"] == "success"
        assert "overall_score" in scoring["raw_output"]
        assert "recommendation" in scoring["raw_output"]

    @pytest.mark.asyncio
    async def test_total_tokens_summed(self):
        orch = _make_mock_orchestrator()
        chunks = [make_chunk()]
        metadata = make_metadata()

        result = await orch.evaluate(chunks, metadata)

        # Each mock agent returns 500 tokens, 8 agents + 0 for scoring = 4000
        assert result["total_tokens"] == 500 * 8

    @pytest.mark.asyncio
    async def test_single_agent_failure_doesnt_crash(self):
        """If one agent fails, pipeline should continue."""
        orch = _make_mock_orchestrator()
        # Make financial agent fail
        orch.financial_agent.analyze = AsyncMock(return_value=AgentResult(
            agent_name="FinancialAgent",
            score=0.0,
            status="failed",
            error="Test failure",
        ))
        chunks = [make_chunk()]
        metadata = make_metadata()

        result = await orch.evaluate(chunks, metadata)

        assert "final_evaluation" in result
        # Financial should show as failed
        assert result["agent_results"]["financial"]["status"] == "failed"
        # Other agents should still have results
        assert result["agent_results"]["technical"]["status"] == "success"
