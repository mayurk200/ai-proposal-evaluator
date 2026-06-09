"""
Tests for app.agents.orchestrator — Pipeline flow, content preparation, metadata mapping, final evaluation.
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
    ProcessedDocument,
    EvaluationResponse,
)
from app.models.enums import ChunkPosition, ChunkType
from tests.conftest import make_chunk, make_metadata, make_agent_result


def _make_mock_orchestrator() -> AgentOrchestrator:
    """Create orchestrator with all agents mocked."""
    orch = AgentOrchestrator.__new__(AgentOrchestrator)

    # 1. Extraction agent
    orch.extraction_agent = MagicMock()
    orch.extraction_agent.name = "ExtractionAgent"
    orch.extraction_agent.analyze = AsyncMock(return_value=make_agent_result(
        name="ExtractionAgent",
        score=90.0,
    ))
    orch.extraction_agent.analyze.return_value.raw_output = {
        "extracted_data": {
            "company_name": "AgriTech",
            "trl_level": "TRL 6",
        }
    }

    # 2. 7 Parameter agents
    param_agent_names = [
        "ProblemRelevanceAgent",
        "SolutionReadinessAgent",
        "PilotDesignAgent",
        "FarmerAdoptionAgent",
        "ScaleUpAgent",
        "TeamCapacityAgent",
        "ComplianceAgent",
    ]
    orch.parameter_agents = []
    for name in param_agent_names:
        mock_agent = MagicMock()
        mock_agent.name = name
        mock_agent.analyze = AsyncMock(return_value=make_agent_result(
            name=name,
            score=80.0,
        ))
        mock_agent.analyze.return_value.sub_questions = []
        orch.parameter_agents.append(mock_agent)

    # 3. Debate Agent
    orch.debate_agent = MagicMock()
    orch.debate_agent.name = "DebateAgent"
    orch.debate_agent.should_trigger = MagicMock(return_value=True)
    orch.debate_agent.analyze = AsyncMock(return_value=make_agent_result(
        name="DebateAgent",
        score=0.0,
    ))
    orch.debate_agent.analyze.return_value.raw_output = {
        "conflicts_found": [{"conflict_id": "c1", "severity": "high"}],
        "debates": [],
        "adjusted_scores": {},
        "high_ambiguity_areas": [],
        "confidence": 0.9,
    }

    # 4. Scoring Agent
    orch.scoring_agent = MagicMock()
    orch.scoring_agent.name = "FinalScoringAgent"
    
    mock_eval = FinalEvaluation(
        overall_score=80.0,
        problem_relevance_score=80.0,
        solution_readiness_score=80.0,
        pilot_design_score=80.0,
        farmer_adoption_score=80.0,
        scaleup_score=80.0,
        team_capacity_score=80.0,
        compliance_score=80.0,
        innovation_score=80.0,
        market_score=80.0,
        agriculture_score=80.0,
        financial_score=80.0,
        scalability_score=80.0,
        sustainability_score=80.0,
        risk_score=80.0,
        technical_score=80.0,
        feasibility_score=80.0,
        recommendation="Recommended",
        summary="A solid proposal.",
        strengths=["Tech"],
        weaknesses=["Gaps"],
        swot_analysis={"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
        key_points=[],
        investment_readiness="Ready",
        key_action_items=[],
        risk_level="Low",
        parameter_breakdown={},
        debate_summary=None,
    )
    orch.scoring_agent.synthesize = AsyncMock(return_value=mock_eval)

    return orch


class TestPrepareContent:
    def test_prepare_content_includes_summary(self):
        orch = AgentOrchestrator()
        metadata = make_metadata()
        chunks = [make_chunk(text="Chunk content here", section_title="Introduction")]
        doc = ProcessedDocument(
            metadata=metadata,
            full_text="Full text content",
            chunks=chunks,
            summary="Executive summary content",
        )
        content = orch._prepare_content(doc)
        assert "EXECUTIVE SUMMARY" in content
        assert "Executive summary content" in content
        assert "Chunk content here" in content
        assert "Section: Introduction" in content

    def test_prepare_content_no_chunks_fallback_to_full_text(self):
        orch = AgentOrchestrator()
        metadata = make_metadata()
        doc = ProcessedDocument(
            metadata=metadata,
            full_text="Only full text is here",
            chunks=[],
            summary="",
        )
        content = orch._prepare_content(doc)
        assert "FULL TEXT" in content
        assert "Only full text is here" in content


class TestMetadataToDict:
    def test_metadata_to_dict_mapping(self):
        orch = AgentOrchestrator()
        metadata = make_metadata()
        m_dict = orch._metadata_to_dict(metadata)
        assert m_dict["filename"] == "test_proposal.pdf"
        assert m_dict["format"] == "pdf"
        assert m_dict["total_pages"] == 5
        assert "detected_sections" in m_dict


class TestEvaluate:
    @pytest.mark.asyncio
    async def test_evaluate_full_pipeline(self):
        orch = _make_mock_orchestrator()
        doc = ProcessedDocument(
            metadata=make_metadata(),
            full_text="Test proposal content",
            chunks=[make_chunk()],
            summary="Test summary",
        )
        
        response = await orch.evaluate(doc)
        
        assert isinstance(response, EvaluationResponse)
        assert response.status == "success"
        assert response.evaluation.overall_score == 80.0
        assert response.evaluation.recommendation == "Recommended"
        
        # Verify all agent calls
        orch.extraction_agent.analyze.assert_called_once()
        assert len(orch.parameter_agents) == 7
        for agent in orch.parameter_agents:
            agent.analyze.assert_called_once()
        orch.debate_agent.analyze.assert_called_once()
        orch.scoring_agent.synthesize.assert_called_once()

    @pytest.mark.asyncio
    async def test_evaluate_debate_skipped(self):
        orch = _make_mock_orchestrator()
        orch.debate_agent.should_trigger.return_value = False
        doc = ProcessedDocument(
            metadata=make_metadata(),
            full_text="Test proposal content",
            chunks=[make_chunk()],
            summary="Test summary",
        )
        
        response = await orch.evaluate(doc)
        
        # Verify debate was NOT called
        orch.debate_agent.analyze.assert_not_called()
        from unittest.mock import ANY
        orch.scoring_agent.synthesize.assert_called_once_with(
            agent_results=ANY,
            debate_result=None,
            proposal_summary="Test summary"
        )

    @pytest.mark.asyncio
    async def test_evaluate_parameter_agent_exception(self):
        orch = _make_mock_orchestrator()
        orch.parameter_agents[0].analyze.side_effect = Exception("Agent failed to run")
        
        doc = ProcessedDocument(
            metadata=make_metadata(),
            full_text="Test proposal content",
            chunks=[make_chunk()],
            summary="Test summary",
        )
        response = await orch.evaluate(doc)
        assert response.status == "success"
        assert response.agent_results["ProblemRelevanceAgent"].status == "failed"
        assert response.agent_results["ProblemRelevanceAgent"].score == 0.0

    @pytest.mark.asyncio
    async def test_evaluate_debate_agent_exception(self):
        orch = _make_mock_orchestrator()
        orch.debate_agent.should_trigger.return_value = True
        orch.debate_agent.analyze.side_effect = Exception("Debate model timeout")
        
        doc = ProcessedDocument(
            metadata=make_metadata(),
            full_text="Test proposal content",
            chunks=[make_chunk()],
            summary="Test summary",
        )
        response = await orch.evaluate(doc)
        assert response.status == "success"
        assert response.evaluation.overall_score == 80.0

    @pytest.mark.asyncio
    async def test_evaluate_scoring_agent_exception(self):
        orch = _make_mock_orchestrator()
        orch.scoring_agent.synthesize.side_effect = Exception("Critical scoring database error")
        
        doc = ProcessedDocument(
            metadata=make_metadata(),
            full_text="Test proposal content",
            chunks=[make_chunk()],
            summary="Test summary",
        )
        response = await orch.evaluate(doc)
        assert response.status == "success"
        assert response.evaluation.overall_score == 0.0
        assert "Scoring failed" in response.evaluation.summary
