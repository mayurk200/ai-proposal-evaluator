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
        "extraction_agent", "technical_agent", "financial_agent",
        "risk_agent", "innovation_agent", "feasibility_agent",
        "compliance_agent", "sustainability_agent", "scoring_agent",
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
                "innovation_score": 70,
                "market_score": 60,
                "agriculture_score": 55,
                "financial_score": 50,
                "scalability_score": 60,
                "sustainability_score": 45,
                "risk_score": 55,
                "technical_score": 75,
                "feasibility_score": 65,
                "compliance_score": 60,
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
            "technical": make_agent_result("TechnicalAgent", 80),
            "financial": make_agent_result("FinancialAgent", 50),
            "risk": make_agent_result("RiskAgent", 60),
            "innovation": make_agent_result("InnovationAgent", 70),
            "feasibility": make_agent_result("FeasibilityAgent", 65),
            "compliance": make_agent_result("ComplianceAgent", 55),
            "sustainability": make_agent_result("SustainabilityAgent", 45),
            "scoring": scoring_result,
        }

        final = orch._build_final_evaluation(scoring_result, agent_results)

        assert isinstance(final, FinalEvaluation)
        assert final.overall_score == 65
        assert final.recommendation == "Conditionally Recommended"
        assert final.risk_level == "Medium"
        assert "Tech" in final.swot_analysis.strengths
        assert "Competition" in final.swot_analysis.threats

    def test_fallback_to_agent_scores(self):
        orch = _make_mock_orchestrator()
        scoring_result = make_agent_result("FinalScoringAgent", 60)
        scoring_result.raw_output = {}  # Empty raw output

        agent_results = {
            "innovation": make_agent_result("InnovationAgent", 70),
            "financial": make_agent_result("FinancialAgent", 50),
            "scoring": scoring_result,
        }

        final = orch._build_final_evaluation(scoring_result, agent_results)
        # Should fall back to individual agent scores
        assert final.innovation_score == 70.0
        assert final.financial_score == 50.0


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
        assert orch.technical_agent.analyze.called
        assert orch.financial_agent.analyze.called
        assert orch.risk_agent.analyze.called
        assert orch.innovation_agent.analyze.called
        assert orch.feasibility_agent.analyze.called
        assert orch.compliance_agent.analyze.called
        assert orch.sustainability_agent.analyze.called
        assert orch.scoring_agent.analyze.called

    @pytest.mark.asyncio
    async def test_pipeline_collects_all_results(self):
        orch = _make_mock_orchestrator()
        chunks = [make_chunk()]
        metadata = make_metadata()

        result = await orch.evaluate(chunks, metadata)

        agent_keys = set(result["agent_results"].keys())
        expected_keys = {
            "extraction", "technical", "financial", "risk",
            "innovation", "feasibility", "compliance", "sustainability", "scoring",
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
