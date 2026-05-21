"""
Tests for app.services.processing.summarizer — chunk summarization, executive summary.
All LLM calls mocked.
"""

import pytest
from unittest.mock import MagicMock, patch

from app.services.processing.summarizer import (
    summarize_chunk,
    create_executive_summary,
)
from tests.conftest import make_chunk


# ============================================================================
# summarize_chunk
# ============================================================================

class TestSummarizeChunk:
    @patch("app.services.processing.summarizer.get_llm_client")
    @pytest.mark.asyncio
    async def test_success(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {
                "summary": "A concise summary of the chunk.",
                "key_points": ["point 1"],
                "financial_highlights": [],
                "technical_highlights": [],
                "claims_to_verify": [],
                "missing_information": [],
            },
            "tokens": 300,
        }
        mock_get_llm.return_value = mock_client

        chunk = make_chunk(text="Some text content to summarize.", section_title="Intro")
        result = await summarize_chunk(chunk)

        assert result["summary"] == "A concise summary of the chunk."
        assert "key_points" in result

    @patch("app.services.processing.summarizer.get_llm_client")
    @pytest.mark.asyncio
    async def test_failure_returns_fallback(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.side_effect = RuntimeError("API error")
        mock_get_llm.return_value = mock_client

        chunk = make_chunk(text="Short text.")
        result = await summarize_chunk(chunk)

        # Fallback should return truncated text
        assert "Short text." in result["summary"]
        assert result["key_points"] == []

    @patch("app.services.processing.summarizer.get_llm_client")
    @pytest.mark.asyncio
    async def test_long_text_truncated_in_fallback(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.side_effect = RuntimeError("fail")
        mock_get_llm.return_value = mock_client

        long_text = "word " * 200  # 1000 chars
        chunk = make_chunk(text=long_text)
        result = await summarize_chunk(chunk)

        assert result["summary"].endswith("...")
        assert len(result["summary"]) <= 504  # 500 + "..."


# ============================================================================
# create_executive_summary
# ============================================================================

class TestCreateExecutiveSummary:
    @patch("app.services.processing.summarizer.get_llm_client")
    @pytest.mark.asyncio
    async def test_small_doc_combines_directly(self, mock_get_llm):
        mock_client = MagicMock()
        # First call: summarize each chunk
        # Second call: combine summaries
        mock_client.chat.side_effect = [
            {"result": {"summary": "Sum 1", "key_points": ["p1"]}, "tokens": 100},
            {"result": {
                "executive_summary": "Combined executive summary.",
                "key_points": ["p1"],
                "financial_highlights": [],
                "technical_highlights": [],
                "all_claims_to_verify": [],
                "missing_information": [],
            }, "tokens": 200},
        ]
        mock_get_llm.return_value = mock_client

        chunks = [make_chunk(text="Short text.")]
        result = await create_executive_summary(chunks)

        assert result["executive_summary"] == "Combined executive summary."

    @patch("app.services.processing.summarizer.get_llm_client")
    @pytest.mark.asyncio
    async def test_with_precomputed_summaries(self, mock_get_llm):
        mock_client = MagicMock()
        mock_client.chat.return_value = {
            "result": {
                "executive_summary": "Pre-combined summary.",
                "key_points": [],
                "financial_highlights": [],
                "technical_highlights": [],
                "all_claims_to_verify": [],
                "missing_information": [],
            },
            "tokens": 200,
        }
        mock_get_llm.return_value = mock_client

        chunks = [make_chunk(text="Chunk text.")]
        precomputed = [{"summary": "Already summarized.", "key_points": []}]
        result = await create_executive_summary(chunks, chunk_summaries=precomputed)

        # Should NOT call summarize_chunk again — only combine
        assert mock_client.chat.call_count == 1

    @patch("app.services.processing.summarizer.get_llm_client")
    @pytest.mark.asyncio
    async def test_combine_failure_concatenates(self, mock_get_llm):
        mock_client = MagicMock()
        # summarize_chunk succeeds, combine fails
        mock_client.chat.side_effect = [
            {"result": {"summary": "Summary A", "key_points": ["p1"], "financial_highlights": [], "technical_highlights": [], "claims_to_verify": ["c1"], "missing_information": []}, "tokens": 100},
            RuntimeError("combine failed"),
        ]
        mock_get_llm.return_value = mock_client

        chunks = [make_chunk(text="Short.")]
        result = await create_executive_summary(chunks)

        # Should fall back to concatenation
        assert "Summary A" in result["executive_summary"]
        assert "p1" in result["key_points"]
