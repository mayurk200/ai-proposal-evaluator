"""
Tests for app.services.processing.document_processor — full pipeline with mocked deps.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.schemas import ProcessedDocument, DocumentMetadata


class TestProcessDocument:
    @patch("app.services.processing.document_processor.create_executive_summary")
    @patch("app.services.processing.document_processor.chunk_document")
    @patch("app.services.processing.document_processor.extract_tables_from_file")
    @patch("app.services.processing.document_processor.extract_images_from_file")
    @patch("app.services.processing.document_processor.extract_text")
    @pytest.mark.asyncio
    async def test_txt_pipeline(self, mock_ext, mock_img, mock_tbl, mock_chunk, mock_sum):
        from app.services.processing.document_processor import process_document
        from tests.conftest import make_chunk

        mock_ext.return_value = {"text": "Hello world content", "page_count": 1}
        mock_img.return_value = []
        mock_tbl.return_value = []
        c = make_chunk(text="Hello world content")
        mock_chunk.return_value = [c]
        mock_sum.return_value = {"executive_summary": "Summary"}

        result = await process_document(
            file_bytes=b"Hello world content",
            filename="test.txt",
        )

        assert isinstance(result, ProcessedDocument)
        assert result.metadata.filename == "test.txt"
        assert result.metadata.format == "txt"
        assert result.summary == "Summary"

    @patch("app.services.processing.document_processor.create_executive_summary")
    @patch("app.services.processing.document_processor.chunk_document")
    @patch("app.services.processing.document_processor.extract_tables_from_file")
    @patch("app.services.processing.document_processor.extract_images_from_file")
    @patch("app.services.processing.document_processor.is_scanned_pdf")
    @patch("app.services.processing.document_processor.extract_text")
    @pytest.mark.asyncio
    async def test_pdf_scanned_detection(self, mock_ext, mock_scan, mock_img, mock_tbl, mock_chunk, mock_sum):
        from app.services.processing.document_processor import process_document
        from tests.conftest import make_chunk

        mock_ext.return_value = {"text": "sparse text", "page_count": 2}
        mock_scan.return_value = True
        mock_img.return_value = []
        mock_tbl.return_value = []
        mock_chunk.return_value = [make_chunk()]
        mock_sum.return_value = {"executive_summary": "S"}

        with patch("app.services.processing.document_processor.ocr_pdf_page") as mock_ocr:
            mock_ocr.return_value = "OCR page text"
            result = await process_document(
                file_bytes=b"pdf-bytes",
                filename="scan.pdf",
            )

        assert result.metadata.has_scanned_content is True
        assert "OCR" in result.full_text or "sparse" in result.full_text

    @patch("app.services.processing.document_processor.chunk_document")
    @patch("app.services.processing.document_processor.extract_tables_from_file")
    @patch("app.services.processing.document_processor.extract_images_from_file")
    @patch("app.services.processing.document_processor.extract_text")
    @pytest.mark.asyncio
    async def test_no_summary(self, mock_ext, mock_img, mock_tbl, mock_chunk):
        from app.services.processing.document_processor import process_document
        mock_ext.return_value = {"text": "content", "page_count": 1}
        mock_img.return_value = []
        mock_tbl.return_value = []
        mock_chunk.return_value = []

        result = await process_document(
            file_bytes=b"content",
            filename="test.txt",
            generate_summary=False,
        )
        assert result.summary == ""

    @patch("app.services.processing.document_processor.create_executive_summary")
    @patch("app.services.processing.document_processor.chunk_document")
    @patch("app.services.processing.document_processor.extract_tables_from_file")
    @patch("app.services.processing.document_processor.extract_images_from_file")
    @patch("app.services.processing.document_processor.extract_text")
    @pytest.mark.asyncio
    async def test_summary_failure_nonfatal(self, mock_ext, mock_img, mock_tbl, mock_chunk, mock_sum):
        from app.services.processing.document_processor import process_document
        from tests.conftest import make_chunk

        mock_ext.return_value = {"text": "some text content", "page_count": 1}
        mock_img.return_value = []
        mock_tbl.return_value = []
        mock_chunk.return_value = [make_chunk(text="some text")]
        mock_sum.side_effect = RuntimeError("LLM down")

        result = await process_document(
            file_bytes=b"some text content",
            filename="test.txt",
        )
        # Should succeed but with empty summary
        assert result.summary == ""

    @patch("app.services.processing.document_processor.ocr_image")
    @pytest.mark.asyncio
    async def test_image_file_processing(self, mock_ocr):
        from app.services.processing.document_processor import process_document

        mock_ocr.return_value = "Image OCR content"

        import io
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (100, 100), "white").save(buf, format="PNG")

        with patch("app.services.processing.document_processor.extract_tables_from_file") as mt, \
             patch("app.services.processing.document_processor.chunk_document") as mc:
            mt.return_value = []
            mc.return_value = []
            result = await process_document(
                file_bytes=buf.getvalue(),
                filename="photo.png",
                generate_summary=False,
            )

        assert result.metadata.has_scanned_content is True
        assert result.metadata.total_pages == 1

    @patch("app.services.processing.document_processor.chunk_document")
    @patch("app.services.processing.document_processor.extract_tables_from_file")
    @patch("app.services.processing.document_processor.extract_images_from_file")
    @patch("app.services.processing.document_processor.extract_text")
    @pytest.mark.asyncio
    async def test_detected_sections(self, mock_ext, mock_img, mock_tbl, mock_chunk):
        from app.services.processing.document_processor import process_document
        from tests.conftest import make_chunk

        mock_ext.return_value = {"text": "content", "page_count": 1}
        mock_img.return_value = []
        mock_tbl.return_value = []
        c1 = make_chunk(section_title="Intro")
        c2 = make_chunk(section_title="Solution")
        mock_chunk.return_value = [c1, c2]

        result = await process_document(
            file_bytes=b"content",
            filename="t.txt",
            generate_summary=False,
        )
        assert "Intro" in result.metadata.detected_sections
        assert "Solution" in result.metadata.detected_sections
