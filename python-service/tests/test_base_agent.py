"""
Tests for app.agents.base_agent — analyze method, score extraction, chunk filtering.
"""

import pytest
from unittest.mock import patch, MagicMock

from app.agents.base_agent import BaseAgent
from app.models.schemas import AgentResult


# ============================================================================
# BaseAgent._extract_score
# ============================================================================

class TestExtractScore:
    def _make_agent(self):
        agent = BaseAgent.__new__(BaseAgent)
        agent.name = "TestAgent"
        agent.system_prompt = "test"
        agent.temperature = 0.3
        agent.max_tokens = 4096
        return agent

    def test_extracts_score_key(self):
        agent = self._make_agent()
        assert agent._extract_score({"score": 75}) == 75.0

    def test_extracts_overall_score(self):
        agent = self._make_agent()
        assert agent._extract_score({"overall_score": 80}) == 80.0

    def test_clamps_to_100(self):
        agent = self._make_agent()
        assert agent._extract_score({"score": 150}) == 100.0

    def test_clamps_to_0(self):
        agent = self._make_agent()
        assert agent._extract_score({"score": -10}) == 0.0

    def test_returns_0_when_missing(self):
        agent = self._make_agent()
        assert agent._extract_score({}) == 0.0

    def test_handles_string_score(self):
        agent = self._make_agent()
        assert agent._extract_score({"score": "75"}) == 75.0

    def test_handles_non_numeric_score(self):
        agent = self._make_agent()
        # Should skip non-numeric and return 0.0
        assert agent._extract_score({"score": "not-a-number"}) == 0.0

    def test_priority_order(self):
        agent = self._make_agent()
        # "score" is checked before "overall_score"
        result = agent._extract_score({"score": 60, "overall_score": 80})
        assert result == 60.0


# ============================================================================
# BaseAgent._filter_chunks_for_agent
# ============================================================================

class TestFilterChunks:
    def _make_agent(self):
        agent = BaseAgent.__new__(BaseAgent)
        agent.name = "TestAgent"
        return agent

    def test_no_filter_joins_all(self):
        agent = self._make_agent()
        chunks = [
            {"text": "chunk 1"},
            {"text": "chunk 2"},
        ]
        result = agent._filter_chunks_for_agent(chunks)
        assert "chunk 1" in result
        assert "chunk 2" in result
        assert "---" in result

    def test_financial_filter(self):
        agent = self._make_agent()
        chunks = [
            {"text": "revenue data", "has_financial_data": True},
            {"text": "general text", "has_financial_data": False},
        ]
        result = agent._filter_chunks_for_agent(chunks, "financial")
        assert "revenue data" in result
        assert "general text" not in result

    def test_technical_filter(self):
        agent = self._make_agent()
        chunks = [
            {"text": "api design", "has_technical_content": True},
            {"text": "general text", "has_technical_content": False},
        ]
        result = agent._filter_chunks_for_agent(chunks, "technical")
        assert "api design" in result

    def test_fallback_to_all_when_no_matches(self):
        agent = self._make_agent()
        chunks = [
            {"text": "no tags", "has_financial_data": False},
            {"text": "also no tags", "has_financial_data": False},
        ]
        result = agent._filter_chunks_for_agent(chunks, "financial")
        assert "no tags" in result
        assert "also no tags" in result


# ============================================================================
# BaseAgent.analyze
# ============================================================================

class TestAnalyze:
    @patch("app.agents.base_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_successful_analysis(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {
                "score": 85,
                "confidence": 0.9,
                "analysis": "Detailed analysis text",
                "key_findings": ["finding 1"],
                "red_flags": ["flag 1"],
                "recommendations": ["rec 1"],
            },
            "tokens": 500,
            "duration_ms": 1200,
            "raw_text": "{}",
        }
        mock_get_llm.return_value = mock_client

        agent = BaseAgent()
        result = await agent.analyze("Test content")

        assert isinstance(result, AgentResult)
        assert result.score == 85.0
        assert result.status == "success"
        assert result.tokens_used == 500
        assert len(result.key_findings) == 1
        assert result.error is None

    @patch("app.agents.base_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_with_metadata(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {"score": 50, "analysis": "ok"},
            "tokens": 100,
            "duration_ms": 500,
            "raw_text": "{}",
        }
        mock_get_llm.return_value = mock_client

        agent = BaseAgent()
        metadata = {
            "filename": "test.pdf",
            "total_pages": 10,
            "total_words": 3000,
            "detected_sections": ["Intro", "Solution"],
        }
        result = await agent.analyze("Content", metadata=metadata)

        # Verify metadata was included in the user_content
        call_args = mock_client.chat.call_args
        user_content = call_args[1]["user_content"] if "user_content" in call_args[1] else call_args[0][1]
        assert "test.pdf" in user_content
        assert "10" in user_content
        assert "Intro, Solution" in user_content

    @patch("app.agents.base_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_error_returns_failed_result(self, mock_get_llm):
        mock_client = MagicMock()
        # The chat method on LLMClient has a tenacity retry decorator, but
        # in tests we mock get_llm_client() which returns a plain MagicMock.
        # The MagicMock.chat() doesn't have the decorator, so the exception
        # propagates directly to the agent's except handler.
        mock_client.chat.side_effect = RuntimeError("API timeout")
        mock_get_llm.return_value = mock_client

        agent = BaseAgent()
        result = await agent.analyze("Content")

        assert result.status == "failed"
        assert result.score == 0.0
        assert result.error is not None
        assert "API timeout" in result.error
        assert result.duration_ms >= 0

    @patch("app.agents.base_agent.get_llm_client")
    @pytest.mark.asyncio
    async def test_custom_temperature(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {"score": 70},
            "tokens": 100,
            "duration_ms": 500,
            "raw_text": "{}",
        }
        mock_get_llm.return_value = mock_client

        agent = BaseAgent(temperature=0.1, max_tokens=2048)
        await agent.analyze("Content")

        call_kwargs = mock_client.chat.call_args[1]
        assert call_kwargs["temperature"] == 0.1
        assert call_kwargs["max_tokens"] == 2048
