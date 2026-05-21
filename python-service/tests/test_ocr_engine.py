"""
Tests for app.services.ocr.ocr_engine — OCR with mocked Tesseract/EasyOCR.
"""

import io
import pytest
from unittest.mock import MagicMock, patch
from PIL import Image


def _make_img(w=100, h=100, mode="RGB"):
    return Image.new(mode, (w, h), "white")


def _make_img_bytes():
    buf = io.BytesIO()
    _make_img().save(buf, format="PNG")
    return buf.getvalue()


class TestOCRImageTesseract:
    def test_success(self):
        from app.services.ocr.ocr_engine import _tesseract_available, ocr_image_tesseract
        if not _tesseract_available:
            pytest.skip("Tesseract not installed")
        # Use real tesseract on a blank image — should return empty or whitespace
        result = ocr_image_tesseract(_make_img())
        assert isinstance(result, str)

    @patch("app.services.ocr.ocr_engine._tesseract_available", False)
    def test_unavailable(self):
        from app.services.ocr.ocr_engine import ocr_image_tesseract
        with pytest.raises(RuntimeError):
            ocr_image_tesseract(_make_img())


class TestOCRImageEasyocr:
    @patch("app.services.ocr.ocr_engine._get_easyocr_reader")
    def test_success(self, mock_reader_fn):
        from app.services.ocr.ocr_engine import ocr_image_easyocr
        r = MagicMock()
        r.readtext.return_value = ["A", "B"]
        mock_reader_fn.return_value = r
        result = ocr_image_easyocr(_make_img())
        assert "A" in result

    @patch("app.services.ocr.ocr_engine._get_easyocr_reader")
    def test_unavailable(self, mock_fn):
        from app.services.ocr.ocr_engine import ocr_image_easyocr
        mock_fn.return_value = None
        with pytest.raises(RuntimeError):
            ocr_image_easyocr(_make_img())


class TestOCRImage:
    @patch("app.services.ocr.ocr_engine.settings")
    def test_disabled(self, s):
        from app.services.ocr.ocr_engine import ocr_image
        s.OCR_ENABLED = False
        assert ocr_image(image=_make_img()) == ""

    @patch("app.services.ocr.ocr_engine.settings")
    @patch("app.services.ocr.ocr_engine._tesseract_available", True)
    @patch("app.services.ocr.ocr_engine.ocr_image_tesseract")
    def test_tesseract_first(self, mock_t, s):
        from app.services.ocr.ocr_engine import ocr_image
        s.OCR_ENABLED = True
        mock_t.return_value = "T text"
        assert ocr_image(image=_make_img()) == "T text"

    @patch("app.services.ocr.ocr_engine.settings")
    @patch("app.services.ocr.ocr_engine._tesseract_available", False)
    @patch("app.services.ocr.ocr_engine._easyocr_available", True)
    @patch("app.services.ocr.ocr_engine.ocr_image_easyocr")
    def test_easyocr_fallback(self, mock_e, s):
        from app.services.ocr.ocr_engine import ocr_image
        s.OCR_ENABLED = True
        mock_e.return_value = "E text"
        assert ocr_image(image=_make_img()) == "E text"

    @patch("app.services.ocr.ocr_engine.settings")
    @patch("app.services.ocr.ocr_engine._tesseract_available", True)
    @patch("app.services.ocr.ocr_engine.ocr_image_tesseract")
    @patch("app.services.ocr.ocr_engine._easyocr_available", True)
    @patch("app.services.ocr.ocr_engine.ocr_image_easyocr")
    def test_fallback_on_empty(self, mock_e, mock_t, s):
        from app.services.ocr.ocr_engine import ocr_image
        s.OCR_ENABLED = True
        mock_t.return_value = ""
        mock_e.return_value = "fallback"
        assert ocr_image(image=_make_img()) == "fallback"

    @patch("app.services.ocr.ocr_engine.settings")
    @patch("app.services.ocr.ocr_engine._tesseract_available", True)
    @patch("app.services.ocr.ocr_engine.ocr_image_tesseract")
    @patch("app.services.ocr.ocr_engine._easyocr_available", True)
    @patch("app.services.ocr.ocr_engine.ocr_image_easyocr")
    def test_fallback_on_error(self, mock_e, mock_t, s):
        from app.services.ocr.ocr_engine import ocr_image
        s.OCR_ENABLED = True
        mock_t.side_effect = RuntimeError("crash")
        mock_e.return_value = "fallback"
        assert ocr_image(image=_make_img()) == "fallback"

    @patch("app.services.ocr.ocr_engine.settings")
    @patch("app.services.ocr.ocr_engine._tesseract_available", False)
    @patch("app.services.ocr.ocr_engine._easyocr_available", False)
    def test_no_engine(self, s):
        from app.services.ocr.ocr_engine import ocr_image
        s.OCR_ENABLED = True
        assert ocr_image(image=_make_img()) == ""

    @patch("app.services.ocr.ocr_engine.settings")
    @patch("app.services.ocr.ocr_engine._tesseract_available", True)
    @patch("app.services.ocr.ocr_engine.ocr_image_tesseract")
    def test_from_bytes(self, mock_t, s):
        from app.services.ocr.ocr_engine import ocr_image
        s.OCR_ENABLED = True
        mock_t.return_value = "from bytes"
        assert ocr_image(image_bytes=_make_img_bytes()) == "from bytes"

    @patch("app.services.ocr.ocr_engine.settings")
    def test_no_input_raises(self, s):
        from app.services.ocr.ocr_engine import ocr_image
        s.OCR_ENABLED = True
        with pytest.raises(ValueError):
            ocr_image()

    @patch("app.services.ocr.ocr_engine.settings")
    @patch("app.services.ocr.ocr_engine._tesseract_available", True)
    @patch("app.services.ocr.ocr_engine.ocr_image_tesseract")
    def test_rgba_converted(self, mock_t, s):
        from app.services.ocr.ocr_engine import ocr_image
        s.OCR_ENABLED = True
        mock_t.return_value = "ok"
        assert ocr_image(image=_make_img(mode="RGBA")) == "ok"


class TestOCRPdfPage:
    @patch("app.services.ocr.ocr_engine.ocr_image")
    def test_renders(self, mock_ocr):
        import fitz
        from app.services.ocr.ocr_engine import ocr_pdf_page
        mock_ocr.return_value = "page text"
        doc = fitz.open()
        doc.new_page()
        pdf_bytes = doc.tobytes()
        doc.close()
        ocr_pdf_page(pdf_bytes=pdf_bytes, page_number=0)
        assert mock_ocr.called

    @patch("app.services.ocr.ocr_engine.ocr_image")
    def test_out_of_range(self, mock_ocr):
        import fitz
        from app.services.ocr.ocr_engine import ocr_pdf_page
        doc = fitz.open()
        doc.new_page()
        pdf_bytes = doc.tobytes()
        doc.close()
        result = ocr_pdf_page(pdf_bytes=pdf_bytes, page_number=5)
        assert result == ""

    def test_no_args(self):
        from app.services.ocr.ocr_engine import ocr_pdf_page
        with pytest.raises(ValueError):
            ocr_pdf_page()


class TestIsScannedPdf:
    def test_scanned(self):
        import fitz
        from app.services.ocr.ocr_engine import is_scanned_pdf
        # Create a PDF with an image but no text
        doc = fitz.open()
        for _ in range(3):
            page = doc.new_page()
            # Insert a small image to make get_images() return something
            img = Image.new("RGB", (50, 50), "red")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            page.insert_image(page.rect, stream=buf.getvalue())
        pdf_bytes = doc.tobytes()
        doc.close()
        assert is_scanned_pdf(pdf_bytes=pdf_bytes) is True

    def test_text_pdf(self):
        import fitz
        from app.services.ocr.ocr_engine import is_scanned_pdf
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 50), " ".join(["word"] * 50))
        pdf_bytes = doc.tobytes()
        doc.close()
        assert is_scanned_pdf(pdf_bytes=pdf_bytes) is False

    def test_no_args(self):
        from app.services.ocr.ocr_engine import is_scanned_pdf
        assert is_scanned_pdf() is False
