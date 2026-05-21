"""
Tests for image_extractor and table_extractor.
"""

import io
import pytest
from unittest.mock import MagicMock, patch
from PIL import Image

from app.models.schemas import ExtractedImage, ExtractedTable


def _make_pil_img(w=200, h=200):
    return Image.new("RGB", (w, h), "blue")


# ============================================================================
# Image Extractor - PDF
# ============================================================================

class TestExtractImagesFromPdf:
    @patch("app.services.extraction.image_extractor.ocr_image")
    def test_extracts_images(self, mock_ocr):
        import fitz
        from app.services.extraction.image_extractor import extract_images_from_pdf
        mock_ocr.return_value = "OCR text"

        # Create a real PDF with an embedded image
        doc = fitz.open()
        page = doc.new_page()
        img_buf = io.BytesIO()
        _make_pil_img().save(img_buf, format="PNG")
        page.insert_image(page.rect, stream=img_buf.getvalue())
        pdf_bytes = doc.tobytes()
        doc.close()

        result = extract_images_from_pdf(file_bytes=pdf_bytes)
        assert len(result) >= 1
        assert isinstance(result[0], ExtractedImage)

    @patch("app.services.extraction.image_extractor.ocr_image")
    def test_no_ocr(self, mock_ocr):
        import fitz
        from app.services.extraction.image_extractor import extract_images_from_pdf

        doc = fitz.open()
        page = doc.new_page()
        img_buf = io.BytesIO()
        _make_pil_img().save(img_buf, format="PNG")
        page.insert_image(page.rect, stream=img_buf.getvalue())
        pdf_bytes = doc.tobytes()
        doc.close()

        result = extract_images_from_pdf(file_bytes=pdf_bytes, run_ocr=False)
        mock_ocr.assert_not_called()

    def test_no_args_raises(self):
        from app.services.extraction.image_extractor import extract_images_from_pdf
        with pytest.raises(ValueError):
            extract_images_from_pdf()


class TestExtractImagesFromFile:
    @patch("app.services.extraction.image_extractor.extract_images_from_pdf")
    def test_routes_pdf(self, mock_fn):
        from app.services.extraction.image_extractor import extract_images_from_file
        mock_fn.return_value = []
        extract_images_from_file(file_bytes=b"x", filename="test.pdf")
        mock_fn.assert_called_once()

    @patch("app.services.extraction.image_extractor.extract_images_from_docx")
    def test_routes_docx(self, mock_fn):
        from app.services.extraction.image_extractor import extract_images_from_file
        mock_fn.return_value = []
        extract_images_from_file(file_bytes=b"x", filename="test.docx")
        mock_fn.assert_called_once()

    @patch("app.services.extraction.image_extractor.extract_images_from_pptx")
    def test_routes_pptx(self, mock_fn):
        from app.services.extraction.image_extractor import extract_images_from_file
        mock_fn.return_value = []
        extract_images_from_file(file_bytes=b"x", filename="test.pptx")
        mock_fn.assert_called_once()

    @patch("app.services.extraction.image_extractor.ocr_image")
    def test_routes_image_file(self, mock_ocr):
        from app.services.extraction.image_extractor import extract_images_from_file
        mock_ocr.return_value = "OCR"
        buf = io.BytesIO()
        _make_pil_img().save(buf, format="PNG")
        result = extract_images_from_file(file_bytes=buf.getvalue(), filename="test.png")
        assert len(result) == 1
        assert result[0].format == "png"

    def test_unknown_ext(self):
        from app.services.extraction.image_extractor import extract_images_from_file
        assert extract_images_from_file(file_bytes=b"x", filename="t.xyz") == []


# ============================================================================
# Table Extractor - PDF
# ============================================================================

class TestExtractTablesFromPdf:
    def test_no_args_raises(self):
        from app.services.extraction.table_extractor import extract_tables_from_pdf
        with pytest.raises(ValueError):
            extract_tables_from_pdf()

    def test_empty_pdf(self):
        import fitz
        from app.services.extraction.table_extractor import extract_tables_from_pdf
        doc = fitz.open()
        doc.new_page()
        pdf_bytes = doc.tobytes()
        doc.close()
        result = extract_tables_from_pdf(file_bytes=pdf_bytes)
        assert result == []  # No tables in blank PDF


class TestExtractTablesFromFile:
    @patch("app.services.extraction.table_extractor.extract_tables_from_pdf")
    def test_routes_pdf(self, mock_fn):
        from app.services.extraction.table_extractor import extract_tables_from_file
        mock_fn.return_value = []
        extract_tables_from_file(file_bytes=b"x", filename="test.pdf")
        mock_fn.assert_called_once()

    @patch("app.services.extraction.table_extractor.extract_tables_from_docx")
    def test_routes_docx(self, mock_fn):
        from app.services.extraction.table_extractor import extract_tables_from_file
        mock_fn.return_value = []
        extract_tables_from_file(file_bytes=b"x", filename="test.docx")
        mock_fn.assert_called_once()

    @patch("app.services.extraction.table_extractor.extract_tables_from_pptx")
    def test_routes_pptx(self, mock_fn):
        from app.services.extraction.table_extractor import extract_tables_from_file
        mock_fn.return_value = []
        extract_tables_from_file(file_bytes=b"x", filename="test.pptx")
        mock_fn.assert_called_once()

    def test_unknown_ext(self):
        from app.services.extraction.table_extractor import extract_tables_from_file
        assert extract_tables_from_file(file_bytes=b"x", filename="t.xyz") == []
