"""
Python service proxy utility for Node.js backend.
Handles file upload forwarding and response mapping.
"""

import httpx
import io
from typing import Any

from app.utils.logging import get_logger

logger = get_logger(__name__)


class PythonServiceClient:
    """Client for communicating with the Python processing service."""

    def __init__(self, base_url: str, timeout: int = 300):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def evaluate_file(
        self,
        file_bytes: bytes,
        filename: str,
        content_type: str = "application/pdf",
        run_ocr: bool = True,
    ) -> dict[str, Any]:
        """
        Send a file to the Python service for full evaluation.

        Args:
            file_bytes: Raw file bytes.
            filename: Original filename.
            content_type: MIME type.
            run_ocr: Whether to run OCR.

        Returns:
            Evaluation response dict.
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            files = {"file": (filename, io.BytesIO(file_bytes), content_type)}
            data = {"run_ocr": str(run_ocr).lower()}

            response = await client.post(
                f"{self.base_url}/api/v1/evaluate",
                files=files,
                data=data,
            )
            response.raise_for_status()
            return response.json()

    async def process_document(
        self,
        file_bytes: bytes,
        filename: str,
        content_type: str = "application/pdf",
        run_ocr: bool = True,
        generate_summary: bool = True,
    ) -> dict[str, Any]:
        """Send a file for document processing only (no evaluation)."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            files = {"file": (filename, io.BytesIO(file_bytes), content_type)}
            data = {
                "run_ocr": str(run_ocr).lower(),
                "generate_summary": str(generate_summary).lower(),
            }

            response = await client.post(
                f"{self.base_url}/api/v1/process-document",
                files=files,
                data=data,
            )
            response.raise_for_status()
            return response.json()

    async def health_check(self) -> dict[str, Any]:
        """Check if the Python service is healthy."""
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{self.base_url}/api/v1/health")
            response.raise_for_status()
            return response.json()
