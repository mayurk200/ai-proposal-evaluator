"""
Tests for app.config — Settings loading, defaults, and derived properties.
"""

import os
import pytest
from unittest.mock import patch


class TestSettings:
    def test_default_values(self):
        from app.config import Settings
        # Create fresh settings without .env influence
        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}, clear=False):
            s = Settings()
            assert s.PORT == 8000
            assert s.ENV == "development"
            assert s.LLM_PROVIDER == "groq"
            assert s.LLM_MODEL == "llama-3.3-70b-versatile"
            assert s.MAX_FILE_SIZE_MB == 50
            assert s.CHUNK_SIZE_TOKENS == 2000
            assert s.CHUNK_OVERLAP_TOKENS == 200
            assert s.OCR_ENABLED is True
            assert s.MAX_RETRIES == 3
            assert s.EVALUATION_TIMEOUT_SECONDS == 300

    def test_supported_formats_list(self):
        from app.config import Settings
        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}, clear=False):
            s = Settings()
            formats = s.supported_formats_list
            assert isinstance(formats, list)
            assert "pdf" in formats
            assert "docx" in formats
            assert "png" in formats
            assert len(formats) == 11

    def test_max_file_size_bytes(self):
        from app.config import Settings
        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}, clear=False):
            s = Settings()
            assert s.max_file_size_bytes == 50 * 1024 * 1024

    def test_custom_formats_string(self):
        from app.config import Settings
        with patch.dict(os.environ, {
            "GROQ_API_KEY": "test-key",
            "SUPPORTED_FORMATS": "pdf, docx",
        }, clear=False):
            s = Settings()
            assert s.supported_formats_list == ["pdf", "docx"]

    def test_custom_env_values(self):
        from app.config import Settings
        with patch.dict(os.environ, {
            "GROQ_API_KEY": "custom-key",
            "PORT": "9000",
            "ENV": "production",
            "MAX_FILE_SIZE_MB": "100",
        }, clear=False):
            s = Settings()
            assert s.PORT == 9000
            assert s.ENV == "production"
            assert s.MAX_FILE_SIZE_MB == 100
            assert s.max_file_size_bytes == 100 * 1024 * 1024
