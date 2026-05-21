"""
Tests for app.services.extraction.text_extractor — text extraction from PDF, DOCX, PPTX, TXT.
All file I/O is mocked.
"""

import pytest
from unittest.mock import MagicMock, patch, mock_open


# ============================================================================
# extract_text_from_txt
# ============================================================================

class TestExtractTextFromTxt:
    def test_from_bytes(self):
        from app.services.extraction.text_extractor import extract_text_from_txt
        result = extract_text_from_txt(file_bytes=b"Hello world, this is a test document.")
        assert "Hello world" in result["text"]

    def test_from_file_path(self, tmp_path):
        from app.services.extraction.text_extractor import extract_text_from_txt
        f = tmp_path / "test.txt"
        f.write_text("Test content from file.", encoding="utf-8")
        result = extract_text_from_txt(file_path=str(f))
        assert "Test content" in result["text"]

    def test_no_args_raises(self):
        from app.services.extraction.text_extractor import extract_text_from_txt
        with pytest.raises(ValueError, match="Either file_path or file_bytes"):
            extract_text_from_txt()

    def test_utf8_errors_handled(self):
        from app.services.extraction.text_extractor import extract_text_from_txt
        # Invalid UTF-8 bytes
        result = extract_text_from_txt(file_bytes=b"Hello \xff\xfe world")
        assert "Hello" in result["text"]


# ============================================================================
# extract_text_from_pdf
# ============================================================================

class TestExtractTextFromPdf:
    @patch("app.services.extraction.text_extractor.fitz")
    def test_from_bytes(self, mock_fitz):
        from app.services.extraction.text_extractor import extract_text_from_pdf

        mock_page = MagicMock()
        mock_page.get_text.return_value = "Page 1 text content"
        mock_page.get_images.return_value = []

        mock_doc = MagicMock()
        mock_doc.__len__ = MagicMock(return_value=1)
        mock_doc.__getitem__ = MagicMock(return_value=mock_page)
        mock_fitz.open.return_value = mock_doc

        result = extract_text_from_pdf(file_bytes=b"fake-pdf")
        assert "Page 1 text" in result["text"]
        assert result["page_count"] == 1
        assert result["has_images"] is False

    @patch("app.services.extraction.text_extractor.fitz")
    def test_multi_page_with_images(self, mock_fitz):
        from app.services.extraction.text_extractor import extract_text_from_pdf

        page1 = MagicMock()
        page1.get_text.return_value = "Introduction"
        page1.get_images.return_value = []

        page2 = MagicMock()
        page2.get_text.return_value = "Solution details"
        page2.get_images.return_value = [(1, 0, 0, 0, 0, "img1", "", "", 0)]

        mock_doc = MagicMock()
        mock_doc.__len__ = MagicMock(return_value=2)
        mock_doc.__getitem__ = MagicMock(side_effect=[page1, page2])
        mock_fitz.open.return_value = mock_doc

        result = extract_text_from_pdf(file_bytes=b"fake-pdf")
        assert result["page_count"] == 2
        assert result["has_images"] is True
        assert "Introduction" in result["text"]
        assert "Solution" in result["text"]

    @patch("app.services.extraction.text_extractor.fitz")
    def test_from_path(self, mock_fitz):
        from app.services.extraction.text_extractor import extract_text_from_pdf

        mock_page = MagicMock()
        mock_page.get_text.return_value = "Content"
        mock_page.get_images.return_value = []

        mock_doc = MagicMock()
        mock_doc.__len__ = MagicMock(return_value=1)
        mock_doc.__getitem__ = MagicMock(return_value=mock_page)
        mock_fitz.open.return_value = mock_doc

        result = extract_text_from_pdf(file_path="/fake/path.pdf")
        mock_fitz.open.assert_called_with("/fake/path.pdf")

    def test_no_args_raises(self):
        from app.services.extraction.text_extractor import extract_text_from_pdf
        with pytest.raises(ValueError, match="Either file_path or file_bytes"):
            extract_text_from_pdf()


# ============================================================================
# extract_text_from_docx
# ============================================================================

class TestExtractTextFromDocx:
    @patch("app.services.extraction.text_extractor.DocxDocument")
    def test_from_bytes(self, mock_docx_cls):
        from app.services.extraction.text_extractor import extract_text_from_docx

        mock_para1 = MagicMock()
        mock_para1.text = "Paragraph one"
        mock_para1.style.name = "Normal"

        mock_para2 = MagicMock()
        mock_para2.text = "Heading Two"
        mock_para2.style.name = "Heading 1"

        mock_doc = MagicMock()
        mock_doc.paragraphs = [mock_para1, mock_para2]
        mock_doc.tables = []
        mock_doc.part.rels.values.return_value = []
        mock_docx_cls.return_value = mock_doc

        result = extract_text_from_docx(file_bytes=b"fake-docx")
        assert "Paragraph one" in result["text"]
        assert result["has_images"] is False

    @patch("app.services.extraction.text_extractor.DocxDocument")
    def test_detects_headings(self, mock_docx_cls):
        from app.services.extraction.text_extractor import extract_text_from_docx

        mock_para = MagicMock()
        mock_para.text = "Executive Summary"
        mock_para.style.name = "Heading 1"

        mock_doc = MagicMock()
        mock_doc.paragraphs = [mock_para]
        mock_doc.tables = []
        mock_doc.part.rels.values.return_value = []
        mock_docx_cls.return_value = mock_doc

        result = extract_text_from_docx(file_bytes=b"fake-docx")
        assert "paragraphs" in result
        assert result["paragraphs"][0]["is_heading"] is True

    @patch("app.services.extraction.text_extractor.DocxDocument")
    def test_with_tables(self, mock_docx_cls):
        from app.services.extraction.text_extractor import extract_text_from_docx

        mock_cell1 = MagicMock()
        mock_cell1.text = "Revenue"
        mock_cell2 = MagicMock()
        mock_cell2.text = "$1M"
        mock_row = MagicMock()
        mock_row.cells = [mock_cell1, mock_cell2]

        mock_table = MagicMock()
        mock_table.rows = [mock_row]

        mock_doc = MagicMock()
        mock_doc.paragraphs = []
        mock_doc.tables = [mock_table]
        mock_doc.part.rels.values.return_value = []
        mock_docx_cls.return_value = mock_doc

        result = extract_text_from_docx(file_bytes=b"fake-docx")
        assert "Revenue" in result["text"]
        assert result["table_count"] == 1

    @patch("app.services.extraction.text_extractor.DocxDocument")
    def test_with_images(self, mock_docx_cls):
        from app.services.extraction.text_extractor import extract_text_from_docx

        mock_rel = MagicMock()
        mock_rel.reltype = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"

        mock_doc = MagicMock()
        mock_doc.paragraphs = []
        mock_doc.tables = []
        mock_doc.part.rels.values.return_value = [mock_rel]
        mock_docx_cls.return_value = mock_doc

        result = extract_text_from_docx(file_bytes=b"fake-docx")
        assert result["has_images"] is True

    def test_no_args_raises(self):
        from app.services.extraction.text_extractor import extract_text_from_docx
        with pytest.raises(ValueError, match="Either file_path or file_bytes"):
            extract_text_from_docx()


# ============================================================================
# extract_text_from_pptx
# ============================================================================

class TestExtractTextFromPptx:
    @patch("app.services.extraction.text_extractor.Presentation")
    def test_from_bytes(self, mock_pptx_cls):
        from app.services.extraction.text_extractor import extract_text_from_pptx

        mock_para = MagicMock()
        mock_para.text = "Slide content here"

        mock_text_frame = MagicMock()
        mock_text_frame.paragraphs = [mock_para]

        mock_shape = MagicMock()
        mock_shape.has_text_frame = True
        mock_shape.text_frame = mock_text_frame
        mock_shape.has_table = False
        mock_shape.shape_type = 0

        mock_slide = MagicMock()
        mock_slide.shapes = [mock_shape]

        mock_prs = MagicMock()
        mock_prs.slides = [mock_slide]
        mock_pptx_cls.return_value = mock_prs

        result = extract_text_from_pptx(file_bytes=b"fake-pptx")
        assert "Slide content" in result["text"]
        assert result["slide_count"] == 1

    @patch("app.services.extraction.text_extractor.Presentation")
    def test_detects_images(self, mock_pptx_cls):
        from app.services.extraction.text_extractor import extract_text_from_pptx

        mock_shape = MagicMock()
        mock_shape.has_text_frame = False
        mock_shape.has_table = False
        mock_shape.shape_type = 13  # Picture

        mock_slide = MagicMock()
        mock_slide.shapes = [mock_shape]

        mock_prs = MagicMock()
        mock_prs.slides = [mock_slide]
        mock_pptx_cls.return_value = mock_prs

        result = extract_text_from_pptx(file_bytes=b"fake-pptx")
        assert result["has_images"] is True

    def test_no_args_raises(self):
        from app.services.extraction.text_extractor import extract_text_from_pptx
        with pytest.raises(ValueError, match="Either file_path or file_bytes"):
            extract_text_from_pptx()


# ============================================================================
# extract_text (unified router)
# ============================================================================

class TestExtractText:
    @patch("app.services.extraction.text_extractor.extract_text_from_pdf")
    def test_routes_pdf(self, mock_pdf):
        from app.services.extraction.text_extractor import extract_text
        mock_pdf.return_value = {"text": "pdf text"}
        result = extract_text(file_bytes=b"data", filename="test.pdf")
        mock_pdf.assert_called_once()
        assert result["text"] == "pdf text"

    @patch("app.services.extraction.text_extractor.extract_text_from_docx")
    def test_routes_docx(self, mock_docx):
        from app.services.extraction.text_extractor import extract_text
        mock_docx.return_value = {"text": "docx text"}
        extract_text(file_bytes=b"data", filename="test.docx")
        mock_docx.assert_called_once()

    @patch("app.services.extraction.text_extractor.extract_text_from_pptx")
    def test_routes_pptx(self, mock_pptx):
        from app.services.extraction.text_extractor import extract_text
        mock_pptx.return_value = {"text": "pptx text"}
        extract_text(file_bytes=b"data", filename="test.pptx")
        mock_pptx.assert_called_once()

    @patch("app.services.extraction.text_extractor.extract_text_from_txt")
    def test_routes_txt(self, mock_txt):
        from app.services.extraction.text_extractor import extract_text
        mock_txt.return_value = {"text": "txt text"}
        extract_text(file_bytes=b"data", filename="test.txt")
        mock_txt.assert_called_once()

    def test_routes_image(self):
        from app.services.extraction.text_extractor import extract_text
        result = extract_text(file_bytes=b"data", filename="photo.png")
        assert result["requires_ocr"] is True

    def test_unsupported_format_raises(self):
        from app.services.extraction.text_extractor import extract_text
        with pytest.raises(ValueError, match="Unsupported file format"):
            extract_text(file_bytes=b"data", filename="test.xyz")

    def test_ext_from_file_path(self):
        from app.services.extraction.text_extractor import extract_text
        result = extract_text(file_bytes=b"data", file_path="/path/to/file.jpg")
        assert result.get("requires_ocr") is True

    def test_ext_from_mime_type(self):
        from app.services.extraction.text_extractor import extract_text
        result = extract_text(file_bytes=b"data", file_type="image/png")
        assert result.get("requires_ocr") is True
