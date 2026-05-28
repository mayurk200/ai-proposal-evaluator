import pytest
import httpx
from unittest.mock import patch, AsyncMock, MagicMock
from app.utils.http_client import PythonServiceClient

@pytest.fixture
def client():
    return PythonServiceClient(base_url="http://test-server")

@pytest.mark.asyncio
async def test_evaluate_file(client):
    mock_response = MagicMock()
    mock_response.json.return_value = {"status": "ok", "evaluation": {}}
    mock_response.raise_for_status.return_value = None

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        result = await client.evaluate_file(b"test data", "test.pdf")
        assert result == {"status": "ok", "evaluation": {}}
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert args[0] == "http://test-server/api/v1/evaluate"
        assert "files" in kwargs
        assert kwargs["data"]["run_ocr"] == "true"

@pytest.mark.asyncio
async def test_process_document(client):
    mock_response = MagicMock()
    mock_response.json.return_value = {"status": "ok", "document": {}}
    mock_response.raise_for_status.return_value = None

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        result = await client.process_document(b"test data", "test.pdf")
        assert result == {"status": "ok", "document": {}}
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert args[0] == "http://test-server/api/v1/process-document"
        assert "files" in kwargs
        assert kwargs["data"]["run_ocr"] == "true"
        assert kwargs["data"]["generate_summary"] == "true"

@pytest.mark.asyncio
async def test_health_check(client):
    mock_response = MagicMock()
    mock_response.json.return_value = {"status": "healthy"}
    mock_response.raise_for_status.return_value = None

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_response
        result = await client.health_check()
        assert result == {"status": "healthy"}
        mock_get.assert_called_once_with("http://test-server/api/v1/health")
