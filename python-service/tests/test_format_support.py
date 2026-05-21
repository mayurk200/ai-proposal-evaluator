"""
Tests for PPT/PPTX and image format support across the Python service.
Validates that the API routes accept these formats and the extractors route correctly.
"""

import pytest
from unittest.mock import patch, MagicMock

from httpx import AsyncClient, ASGITransport
from app.main import app


# ============================================================================
# API accepts PPTX/PPT extensions
# ============================================================================

class TestAPIFormatAcceptance:
    @pytest.mark.asyncio
    @patch("app.api.routes.process_document")
    async def test_accepts_pptx(self, mock_process):
        from app.models.schemas import ProcessedDocument, DocumentMetadata
        mock_process.return_value = ProcessedDocument(
            metadata=DocumentMetadata(filename="slides.pptx", format="pptx"),
            full_text="Slide content " * 20,
            chunks=[],
        )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/process-document",
                files={"file": ("slides.pptx", b"fake-pptx-content", "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
            )
        assert resp.status_code == 200
        assert resp.json()["status"] == "success"

    @pytest.mark.asyncio
    @patch("app.api.routes.process_document")
    async def test_accepts_ppt(self, mock_process):
        from app.models.schemas import ProcessedDocument, DocumentMetadata
        mock_process.return_value = ProcessedDocument(
            metadata=DocumentMetadata(filename="slides.ppt", format="ppt"),
            full_text="Slide content " * 20,
            chunks=[],
        )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/process-document",
                files={"file": ("slides.ppt", b"fake-ppt-content", "application/vnd.ms-powerpoint")},
            )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    @patch("app.api.routes.process_document")
    async def test_accepts_png(self, mock_process):
        from app.models.schemas import ProcessedDocument, DocumentMetadata
        mock_process.return_value = ProcessedDocument(
            metadata=DocumentMetadata(filename="photo.png", format="png"),
            full_text="OCR content " * 20,
            chunks=[],
        )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/process-document",
                files={"file": ("photo.png", b"fake-png", "image/png")},
            )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    @patch("app.api.routes.process_document")
    async def test_accepts_jpg(self, mock_process):
        from app.models.schemas import ProcessedDocument, DocumentMetadata
        mock_process.return_value = ProcessedDocument(
            metadata=DocumentMetadata(filename="photo.jpg", format="jpg"),
            full_text="OCR content " * 20,
            chunks=[],
        )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/process-document",
                files={"file": ("photo.jpg", b"fake-jpg", "image/jpeg")},
            )
        assert resp.status_code == 200


# ============================================================================
# Text extractor routes PPTX to correct handler
# ============================================================================

class TestTextExtractorRouting:
    @patch("app.services.extraction.text_extractor.extract_text_from_pptx")
    def test_routes_pptx(self, mock_pptx):
        from app.services.extraction.text_extractor import extract_text
        mock_pptx.return_value = {"text": "pptx text", "slides": [], "slide_count": 1, "has_images": False}
        result = extract_text(file_bytes=b"data", filename="test.pptx")
        mock_pptx.assert_called_once()
        assert result["text"] == "pptx text"

    @patch("app.services.extraction.text_extractor.extract_text_from_pptx")
    def test_routes_ppt(self, mock_pptx):
        from app.services.extraction.text_extractor import extract_text
        mock_pptx.return_value = {"text": "ppt text", "slides": [], "slide_count": 1, "has_images": False}
        result = extract_text(file_bytes=b"data", filename="test.ppt")
        mock_pptx.assert_called_once()

    def test_routes_png_to_ocr(self):
        from app.services.extraction.text_extractor import extract_text
        result = extract_text(file_bytes=b"data", filename="photo.png")
        assert result["requires_ocr"] is True

    def test_routes_jpg_to_ocr(self):
        from app.services.extraction.text_extractor import extract_text
        result = extract_text(file_bytes=b"data", filename="photo.jpg")
        assert result["requires_ocr"] is True

    def test_routes_jpeg_to_ocr(self):
        from app.services.extraction.text_extractor import extract_text
        result = extract_text(file_bytes=b"data", filename="photo.jpeg")
        assert result["requires_ocr"] is True

    def test_routes_tiff_to_ocr(self):
        from app.services.extraction.text_extractor import extract_text
        result = extract_text(file_bytes=b"data", filename="photo.tiff")
        assert result["requires_ocr"] is True

    def test_routes_bmp_to_ocr(self):
        from app.services.extraction.text_extractor import extract_text
        result = extract_text(file_bytes=b"data", filename="photo.bmp")
        assert result["requires_ocr"] is True


# ============================================================================
# Image extractor routes correctly
# ============================================================================

class TestImageExtractorRouting:
    @patch("app.services.extraction.image_extractor.extract_images_from_pptx")
    def test_pptx_images(self, mock_fn):
        from app.services.extraction.image_extractor import extract_images_from_file
        mock_fn.return_value = []
        extract_images_from_file(file_bytes=b"x", filename="slides.pptx")
        mock_fn.assert_called_once()

    @patch("app.services.extraction.image_extractor.extract_images_from_pptx")
    def test_ppt_images(self, mock_fn):
        from app.services.extraction.image_extractor import extract_images_from_file
        mock_fn.return_value = []
        extract_images_from_file(file_bytes=b"x", filename="slides.ppt")
        mock_fn.assert_called_once()

    @patch("app.services.extraction.image_extractor.ocr_image")
    def test_direct_image_extraction(self, mock_ocr):
        import io
        from PIL import Image
        from app.services.extraction.image_extractor import extract_images_from_file

        mock_ocr.return_value = "OCR from image"
        buf = io.BytesIO()
        Image.new("RGB", (100, 100), "white").save(buf, format="PNG")

        result = extract_images_from_file(file_bytes=buf.getvalue(), filename="photo.jpg")
        assert len(result) == 1
        assert result[0].format == "jpg"


# ============================================================================
# Table extractor routes correctly
# ============================================================================

class TestTableExtractorRouting:
    @patch("app.services.extraction.table_extractor.extract_tables_from_pptx")
    def test_pptx_tables(self, mock_fn):
        from app.services.extraction.table_extractor import extract_tables_from_file
        mock_fn.return_value = []
        extract_tables_from_file(file_bytes=b"x", filename="slides.pptx")
        mock_fn.assert_called_once()

    def test_image_no_tables(self):
        from app.services.extraction.table_extractor import extract_tables_from_file
        result = extract_tables_from_file(file_bytes=b"x", filename="photo.png")
        assert result == []
