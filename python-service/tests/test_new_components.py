"""
Unit tests for newly introduced components: Form Field Extractor, Parameter Agents,
Debate Agent and Final Scoring Agent.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx

from app.services.extraction.form_field_extractor import extract_form_fields
from app.agents.problem_relevance.problem_relevance_agent import ProblemRelevanceAgent
from app.agents.debate.debate_agent import DebateAgent
from app.agents.scoring.scoring_agent import ScoringAgent
from app.models.schemas import (
    AgentResult,
    SubQuestionResult,
    FinalEvaluation,
)


# ============================================================================
# Form Field Extractor Tests
# ============================================================================

class TestFormFieldExtractor:
    def test_extract_form_fields_from_empty_text(self):
        fields = extract_form_fields("")
        assert fields["completeness"] == 0.0
        assert fields["qa_pairs_count"] == 0
        assert len(fields["fields"]) == 0

    def test_extract_form_fields_with_valid_form_patterns(self):
        text = (
            "Website\nwww.greenagri.com\n"
            "Email\njane@greenagri.com\n"
            "Contact Number\n+919876543210\n"
            "State\nMaharashtra\n"
            "TRL Level\nTRL 6\n"
            "Total Project Cost\nINR 50,00,000\n"
        )
        fields = extract_form_fields(text)
        assert fields["fields"]["Website"] == "www.greenagri.com"
        assert fields["fields"]["Email"] == "jane@greenagri.com"
        assert fields["fields"]["Contact Number"] == "+919876543210"
        assert fields["fields"]["State"] == "Maharashtra"
        assert fields["fields"]["TRL Level"] == "TRL 6"
        assert fields["fields"]["Total Project Cost"] == "INR 50,00,000"
        assert fields["completeness"] > 0.0

    def test_extract_form_fields_financial_numbers_and_team(self):
        text = (
            "Total Project Cost\nINR 5,00,000 and INR 2,00,000\n"
            "Core Team and Leadership\n"
            "Dr. Anil Kumar\nPhD in Agronomy\nhttps://www.linkedin.com/in/anil-kumar\n"
            "Ms. Priya Sharma\nMTech in IoT\nhttps://www.linkedin.com/in/priya-sharma\n"
        )
        fields = extract_form_fields(text)
        assert len(fields["financial_numbers"]) >= 2
        # Verify team members
        member_names = [m["name"] for m in fields["team_members"]]
        assert "Dr. Anil Kumar" in member_names
        assert "Ms. Priya Sharma" in member_names


# ============================================================================
# Parameter Agents Tests
# ============================================================================

class TestParameterAgents:
    @patch("app.agents.base_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_parameter_agent_success(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {
                "score": 90.0,
                "confidence": 0.9,
                "analysis": "The problem has high relevance.",
                "key_findings": ["F1"],
                "red_flags": [],
                "recommendations": ["R1"],
                "sub_questions": [
                    {
                        "question_id": "1.1",
                        "question": "Is the problem well defined?",
                        "score": 9.0,
                        "evidence": "Problem statement clear",
                        "justification": "Detailed justification here.",
                        "mapped_fields_found": ["problem_statement"]
                    }
                ]
            },
            "tokens": 400,
            "duration_ms": 800,
            "raw_text": "{}",
        }
        mock_get_llm.return_value = mock_client

        agent = ProblemRelevanceAgent()
        result = await agent.analyze("Text content", form_fields={"company_name": "AgriTech"})
        
        assert isinstance(result, AgentResult)
        assert result.score == 90.0
        assert len(result.sub_questions) == 1
        assert result.sub_questions[0].question_id == "1.1"

    @patch("app.agents.base_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_all_parameter_agents(self, mock_get_llm):
        from app.agents.solution_readiness.solution_readiness_agent import SolutionReadinessAgent
        from app.agents.pilot_design.pilot_design_agent import PilotDesignAgent
        from app.agents.farmer_adoption.farmer_adoption_agent import FarmerAdoptionAgent
        from app.agents.scaleup.scaleup_agent import ScaleUpAgent
        from app.agents.team_capacity.team_capacity_agent import TeamCapacityAgent
        from app.agents.compliance.compliance_agent import ComplianceAgent

        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {
                "confidence": 0.85,
                "analysis": "Testing analysis",
                "key_findings": ["Finding"],
                "red_flags": [],
                "recommendations": ["Recommendation"],
                "sub_questions": [
                    {
                        "question_id": "sq_1",
                        "question": "Sub-question 1",
                        "score": 8.0,
                        "evidence": "Evidence",
                        "justification": "Justification",
                        "mapped_fields_found": ["field"]
                    }
                ]
            },
            "tokens": 200,
            "duration_ms": 300,
            "raw_text": "{}",
        }
        mock_get_llm.return_value = mock_client

        agents = [
            SolutionReadinessAgent(),
            PilotDesignAgent(),
            FarmerAdoptionAgent(),
            ScaleUpAgent(),
            TeamCapacityAgent(),
            ComplianceAgent(),
        ]

        for agent in agents:
            result = await agent.analyze("Some text content")
            assert isinstance(result, AgentResult)
            assert result.score == 80.0
            assert result.status == "success"

    @patch("app.agents.base_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_parameter_agents_fallback_score(self, mock_get_llm):
        from app.agents.problem_relevance.problem_relevance_agent import ProblemRelevanceAgent
        from app.agents.solution_readiness.solution_readiness_agent import SolutionReadinessAgent
        from app.agents.pilot_design.pilot_design_agent import PilotDesignAgent
        from app.agents.farmer_adoption.farmer_adoption_agent import FarmerAdoptionAgent
        from app.agents.scaleup.scaleup_agent import ScaleUpAgent
        from app.agents.team_capacity.team_capacity_agent import TeamCapacityAgent
        from app.agents.compliance.compliance_agent import ComplianceAgent

        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {
                "score": 85.0,
                "confidence": 0.85,
                "analysis": "Testing fallback",
            },
            "tokens": 200,
            "duration_ms": 300,
            "raw_text": "{}",
        }
        mock_get_llm.return_value = mock_client

        agents = [
            ProblemRelevanceAgent(),
            SolutionReadinessAgent(),
            PilotDesignAgent(),
            FarmerAdoptionAgent(),
            ScaleUpAgent(),
            TeamCapacityAgent(),
            ComplianceAgent(),
        ]

        for agent in agents:
            result = await agent.analyze("Some text content")
            assert result.score == 85.0


# ============================================================================
# Debate Agent Tests
# ============================================================================

class TestDebateAgent:
    def test_debate_agent_trigger_conditions(self):
        agent = DebateAgent()
        # High scoring variance should trigger (we need >=3 agents)
        results1 = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=90, status="success"),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=40, status="success"),
            "PilotDesignAgent": AgentResult(agent_name="PilotDesignAgent", score=50, status="success"),
        }
        assert agent.should_trigger(results1) is True

        # Less than 3 agents should not trigger
        results_small = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=75, status="success"),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=70, status="success"),
        }
        assert agent.should_trigger(results_small) is False

        # Red flags present should trigger
        results3 = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=75, status="success", red_flags=["Flag"]),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=70, status="success"),
            "PilotDesignAgent": AgentResult(agent_name="PilotDesignAgent", score=72, status="success"),
        }
        assert agent.should_trigger(results3) is True

    @patch("app.agents.debate.debate_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_debate_agent_analyze(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {
                "conflicts_found": [{"conflict_id": "c1", "description": "Score mismatch", "severity": "high"}],
                "debates": [{"round": 1, "agent": "DebateAgent", "argument": "Checking scores..."}],
                "adjusted_scores": {"ProblemRelevanceAgent": 85.0},
                "high_ambiguity_areas": ["Financial viability"],
                "confidence": 0.88,
                "analysis": "The debate was conclusive.",
            },
            "tokens": 600,
            "duration_ms": 1500,
            "raw_text": "{}",
        }
        mock_get_llm.return_value = mock_client

        agent = DebateAgent()
        results = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=90.0, status="success"),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=40.0, status="success"),
            "PilotDesignAgent": AgentResult(agent_name="PilotDesignAgent", score=50.0, status="success"),
        }
        debate_result = await agent.analyze(agent_results=results, proposal_summary="Text content")
        
        assert debate_result.score == 0.0
        assert len(debate_result.raw_output["conflicts_found"]) == 1
        assert debate_result.raw_output["adjusted_scores"]["ProblemRelevanceAgent"] == 85.0


# ============================================================================
# Final Scoring Agent Tests
# ============================================================================

class TestDebateAgent:
    def test_debate_agent_trigger_conditions(self):
        agent = DebateAgent()
        # High scoring variance should trigger (we need >=3 agents)
        results1 = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=90, status="success"),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=40, status="success"),
            "PilotDesignAgent": AgentResult(agent_name="PilotDesignAgent", score=50, status="success"),
        }
        assert agent.should_trigger(results1) is True

        # Less than 3 agents should not trigger
        results_small = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=75, status="success"),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=70, status="success"),
        }
        assert agent.should_trigger(results_small) is False

        # Red flags present should trigger
        results3 = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=75, status="success", red_flags=["Flag"]),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=70, status="success"),
            "PilotDesignAgent": AgentResult(agent_name="PilotDesignAgent", score=72, status="success"),
        }
        assert agent.should_trigger(results3) is True

    @patch("app.agents.debate.debate_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_debate_agent_analyze(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {
                "conflicts_found": [{"conflict_id": "c1", "description": "Score mismatch", "severity": "high"}],
                "debates": [{"round": 1, "agent": "DebateAgent", "argument": "Checking scores..."}],
                "adjusted_scores": {"ProblemRelevanceAgent": 85.0},
                "high_ambiguity_areas": ["Financial viability"],
                "confidence": 0.88,
                "analysis": "The debate was conclusive.",
            },
            "tokens": 600,
            "duration_ms": 1500,
            "raw_text": "{}",
        }
        mock_get_llm.return_value = mock_client

        agent = DebateAgent()
        results = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=90.0, status="success"),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=40.0, status="success"),
            "PilotDesignAgent": AgentResult(agent_name="PilotDesignAgent", score=50.0, status="success"),
        }
        debate_result = await agent.analyze(agent_results=results, proposal_summary="Text content")
        
        assert debate_result.score == 0.0
        assert len(debate_result.raw_output["conflicts_found"]) == 1
        assert debate_result.raw_output["adjusted_scores"]["ProblemRelevanceAgent"] == 85.0

    def test_debate_agent_apply_adjustments(self):
        agent = DebateAgent()
        results = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=90.0, status="success"),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=70.0, status="success"),
        }
        debate_raw = {
            "adjusted_scores": {
                "ProblemRelevance": 85.0,
                "SolutionReadiness": "invalid_score",
            }
        }
        adjusted = agent.apply_adjustments(results, debate_raw)
        assert adjusted["ProblemRelevanceAgent"] == 85.0
        assert adjusted["SolutionReadinessAgent"] == 70.0

    def test_debate_agent_build_input_with_failed_agent(self):
        agent = DebateAgent()
        results = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=90.0, status="failed", error="timeout"),
            "SolutionReadinessAgent": AgentResult(
                agent_name="SolutionReadinessAgent",
                score=70.0,
                status="success",
                sub_questions=[],
                key_findings=["Finding"],
                red_flags=["Flag"]
            ),
        }
        input_str = agent._build_debate_input(results, "Proposal summary")
        assert "ProblemRelevanceAgent [FAILED]" in input_str
        assert "RED FLAGS: Flag" in input_str


# ============================================================================
# Final Scoring Agent Tests
# ============================================================================

class TestFinalScoringAgent:
    @patch("app.agents.scoring.scoring_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_scoring_agent_synthesize_no_debate(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {
                "overall_score": 78.5,
                "recommendation": "Recommended",
                "risk_level": "Low",
                "summary": "Synthesized evaluation content",
                "strengths": ["Strong technology"],
                "weaknesses": ["Weak market research"],
                "swot_analysis": {
                    "strengths": ["Technology"],
                    "weaknesses": ["Market research"],
                    "opportunities": ["Global expansion"],
                    "threats": ["New competitors"]
                },
                "key_action_items": ["A1"],
                "investment_readiness": "Medium-High",
                "confidence": 0.9
            },
            "tokens": 800,
            "duration_ms": 2000,
            "raw_text": "{}",
        }
        mock_get_llm.return_value = mock_client

        agent = ScoringAgent()
        results = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=78.5, status="success"),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=78.5, status="success"),
            "PilotDesignAgent": AgentResult(agent_name="PilotDesignAgent", score=78.5, status="success"),
            "FarmerAdoptionAgent": AgentResult(agent_name="FarmerAdoptionAgent", score=78.5, status="success"),
            "ScaleUpAgent": AgentResult(agent_name="ScaleUpAgent", score=78.5, status="success"),
            "TeamCapacityAgent": AgentResult(agent_name="TeamCapacityAgent", score=78.5, status="success"),
            "ComplianceAgent": AgentResult(agent_name="ComplianceAgent", score=78.5, status="success"),
        }
        
        final_eval = await agent.synthesize(
            agent_results=results,
            debate_result=None,
            proposal_summary="Summary text"
        )
        
        assert isinstance(final_eval, FinalEvaluation)
        assert final_eval.overall_score == 78.5
        assert final_eval.problem_relevance_score == 78.5
        assert final_eval.recommendation == "Recommended"
        assert final_eval.debate_summary is None

    @patch("app.agents.scoring.scoring_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_scoring_agent_synthesize_with_debate(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {
                "overall_score": 75.0,
                "recommendation": "Recommended with conditions",
                "risk_level": "Medium",
                "summary": "Synthesized evaluation content with debate",
                "strengths": ["Strong tech"],
                "weaknesses": ["Low adoption plan"],
                "swot_analysis": {
                    "strengths": ["Tech"],
                    "weaknesses": ["Adoption"],
                    "opportunities": ["State support"],
                    "threats": ["Funding"]
                },
                "key_action_items": ["A1"],
                "investment_readiness": "Medium",
                "confidence": 0.85
            },
            "tokens": 800,
            "duration_ms": 2000,
            "raw_text": "{}",
        }
        mock_get_llm.return_value = mock_client

        agent = ScoringAgent()
        results = {
            "ProblemRelevanceAgent": AgentResult(agent_name="ProblemRelevanceAgent", score=80.0, status="success"),
            "SolutionReadinessAgent": AgentResult(agent_name="SolutionReadinessAgent", score=80.0, status="success"),
            "PilotDesignAgent": AgentResult(agent_name="PilotDesignAgent", score=80.0, status="success"),
            "FarmerAdoptionAgent": AgentResult(agent_name="FarmerAdoptionAgent", score=80.0, status="success"),
            "ScaleUpAgent": AgentResult(agent_name="ScaleUpAgent", score=80.0, status="success"),
            "TeamCapacityAgent": AgentResult(agent_name="TeamCapacityAgent", score=80.0, status="success"),
            "ComplianceAgent": AgentResult(agent_name="ComplianceAgent", score=80.0, status="success"),
        }

        debate_result = AgentResult(
            agent_name="DebateAgent",
            score=0.0,
            confidence=0.8,
            analysis="Debate completed",
            raw_output={
                "conflicts_found": [{"conflict_id": "c1", "description": "Score mismatch", "severity": "medium"}],
                "debates": [{"round": 1, "agent": "DebateAgent", "argument": "Checking scores"}],
                "adjusted_scores": {"ProblemRelevanceAgent": 70.0},
                "high_ambiguity_areas": ["Farmer adoption"],
                "confidence": 0.8
            },
            status="success"
        )
        
        final_eval = await agent.synthesize(
            agent_results=results,
            debate_result=debate_result,
            proposal_summary="Summary text"
        )
        
        assert isinstance(final_eval, FinalEvaluation)
        assert final_eval.overall_score == 78.5
        assert final_eval.debate_summary is not None
        assert len(final_eval.debate_summary.adjusted_scores) == 1


