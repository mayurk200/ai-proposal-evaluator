"""
Tests for app.services.llm.llm_client — Client init, chat, retry, JSON parsing.
All Groq API calls are mocked.
"""

import json
import os
import pytest
from unittest.mock import MagicMock, patch, PropertyMock

from app.services.llm.llm_client import LLMClient, get_llm_client, _llm_client


# ---------------------------------------------------------------------------
# Helper: build a mock Groq completion response
# ---------------------------------------------------------------------------

def _mock_completion(content: str = '{"score": 75}', tokens: int = 100):
    """Create a mock Groq ChatCompletion object."""
    choice = MagicMock()
    choice.message.content = content

    usage = MagicMock()
    usage.total_tokens = tokens

    completion = MagicMock()
    completion.choices = [choice]
    completion.usage = usage
    return completion


# ============================================================================
# LLMClient init
# ============================================================================

class TestLLMClientInit:
    def test_raises_without_api_key(self):
        with patch("app.services.llm.llm_client.settings") as mock_settings:
            mock_settings.GROQ_API_KEY = ""
            with pytest.raises(ValueError, match="GROQ_API_KEY is required"):
                LLMClient(api_key="")

    @patch("app.services.llm.llm_client.Groq")
    def test_creates_with_key(self, mock_groq):
        client = LLMClient(api_key="test-key-123")
        assert client.api_key == "test-key-123"
        mock_groq.assert_called_once_with(api_key="test-key-123")

    @patch("app.services.llm.llm_client.Groq")
    def test_custom_params(self, mock_groq):
        client = LLMClient(
            api_key="key",
            model="custom-model",
            temperature=0.5,
            max_tokens=2048,
        )
        assert client.model == "custom-model"
        assert client.temperature == 0.5
        assert client.max_tokens == 2048


# ============================================================================
# chat method
# ============================================================================

class TestLLMClientChat:
    @patch("app.services.llm.llm_client.Groq")
    def test_basic_chat(self, mock_groq_cls):
        mock_client = MagicMock()
        mock_groq_cls.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion()

        client = LLMClient(api_key="test-key")
        result = client.chat(
            system_prompt="You are a test bot.",
            user_content="Hello",
        )

        assert result["result"]["score"] == 75
        assert result["tokens"] == 100
        assert "duration_ms" in result
        assert "raw_text" in result

    @patch("app.services.llm.llm_client.Groq")
    def test_json_mode_sends_response_format(self, mock_groq_cls):
        mock_client = MagicMock()
        mock_groq_cls.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion()

        client = LLMClient(api_key="test-key")
        client.chat("system", "user", json_mode=True)

        call_kwargs = mock_client.chat.completions.create.call_args[1]
        assert call_kwargs["response_format"] == {"type": "json_object"}

    @patch("app.services.llm.llm_client.Groq")
    def test_non_json_mode_no_response_format(self, mock_groq_cls):
        mock_client = MagicMock()
        mock_groq_cls.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion()

        client = LLMClient(api_key="test-key")
        client.chat("system", "user", json_mode=False)

        call_kwargs = mock_client.chat.completions.create.call_args[1]
        assert "response_format" not in call_kwargs

    @patch("app.services.llm.llm_client.Groq")
    def test_overrides_per_call(self, mock_groq_cls):
        mock_client = MagicMock()
        mock_groq_cls.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion()

        client = LLMClient(api_key="test-key")
        client.chat("system", "user", model="override-model", temperature=0.9, max_tokens=1024)

        call_kwargs = mock_client.chat.completions.create.call_args[1]
        assert call_kwargs["model"] == "override-model"
        assert call_kwargs["temperature"] == 0.9
        assert call_kwargs["max_tokens"] == 1024

    @patch("app.services.llm.llm_client.Groq")
    def test_handles_none_content(self, mock_groq_cls):
        """If LLM returns None content, should default to empty JSON."""
        mock_client = MagicMock()
        mock_groq_cls.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_completion(content=None)

        # When content is None, the code does `or "{}"` which should parse to {}
        client = LLMClient(api_key="test-key")
        # The `or "{}"` fallback is correct — but let's verify content=None is handled
        completion = mock_client.chat.completions.create.return_value
        completion.choices[0].message.content = None
        result = client.chat("system", "user")
        assert result["result"] == {}

    @patch("app.services.llm.llm_client.Groq")
    def test_handles_no_usage(self, mock_groq_cls):
        """If usage is None, tokens should be 0."""
        mock_client = MagicMock()
        mock_groq_cls.return_value = mock_client
        comp = _mock_completion()
        comp.usage = None
        mock_client.chat.completions.create.return_value = comp

        client = LLMClient(api_key="test-key")
        result = client.chat("system", "user")
        assert result["tokens"] == 0


# ============================================================================
# JSON parsing
# ============================================================================

class TestJSONParsing:
    @patch("app.services.llm.llm_client.Groq")
    def _get_client(self, mock_groq_cls):
        return LLMClient(api_key="test-key")

    def test_plain_json(self):
        client = self._get_client()
        result = client._parse_json_response('{"key": "value"}')
        assert result == {"key": "value"}

    def test_markdown_wrapped_json(self):
        client = self._get_client()
        result = client._parse_json_response('```json\n{"key": "value"}\n```')
        assert result == {"key": "value"}

    def test_triple_backtick_without_json_label(self):
        client = self._get_client()
        result = client._parse_json_response('```\n{"key": "value"}\n```')
        assert result == {"key": "value"}

    def test_json_embedded_in_text(self):
        client = self._get_client()
        text = 'Here is the result: {"score": 80} and some trailing text'
        result = client._parse_json_response(text)
        assert result["score"] == 80

    def test_nested_json_extraction(self):
        client = self._get_client()
        text = 'Result: {"outer": {"inner": 42}}'
        result = client._parse_json_response(text)
        assert result["outer"]["inner"] == 42

    def test_completely_invalid_returns_error_dict(self):
        client = self._get_client()
        result = client._parse_json_response("no json here at all")
        assert "error" in result
        assert "raw" in result

    def test_empty_string(self):
        client = self._get_client()
        result = client._parse_json_response("")
        assert "error" in result


# ============================================================================
# Singleton
# ============================================================================

class TestGetLLMClient:
    @patch("app.services.llm.llm_client.Groq")
    def test_returns_same_instance(self, mock_groq_cls):
        import app.services.llm.llm_client as mod
        mod._llm_client = None  # Reset singleton

        client1 = get_llm_client()
        client2 = get_llm_client()
        assert client1 is client2

        mod._llm_client = None  # Cleanup
