"""
OCR engine for extracting text from images and scanned documents.
Uses pytesseract (Tesseract OCR) as primary, with easyocr as fallback.
"""

import io
from pathlib import Path
from typing import Optional

from PIL import Image

from app.config import settings
from app.utils.logging import get_logger
from app.utils.text_cleaning import clean_text, assess_text_quality

logger = get_logger(__name__)

# Configure tesseract path if specified
_tesseract_available = False
_easyocr_available = False

try:
    import pytesseract

    if settings.TESSERACT_CMD:
        pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD
    # Quick check that tesseract is accessible
    pytesseract.get_tesseract_version()
    _tesseract_available = True
    logger.info("tesseract_available", version=str(pytesseract.get_tesseract_version()))
except Exception as e:
    logger.warning("tesseract_unavailable", error=str(e))

try:
    import easyocr

    _easyocr_available = True
    logger.info("easyocr_available")
except ImportError:
    logger.warning("easyocr_unavailable")

# Lazy-loaded easyocr reader
_easyocr_reader = None


def _get_easyocr_reader():
    """Lazy-load easyocr reader to avoid startup overhead."""
    global _easyocr_reader
    if _easyocr_reader is None and _easyocr_available:
        import easyocr

        _easyocr_reader = easyocr.Reader(
            [settings.OCR_LANGUAGE[:2]],  # easyocr uses 'en' not 'eng'
            gpu=False,
        )
    return _easyocr_reader


def ocr_image_tesseract(image: Image.Image, language: str = "eng") -> str:
    """
    Run Tesseract OCR on a PIL Image.

    Args:
        image: PIL Image object.
        language: Tesseract language code.

    Returns:
        Extracted text.
    """
    if not _tesseract_available:
        raise RuntimeError("Tesseract OCR is not available")

    import pytesseract

    text = pytesseract.image_to_string(image, lang=language)
    return clean_text(text, is_ocr=True)


def ocr_image_easyocr(image: Image.Image) -> str:
    """
    Run EasyOCR on a PIL Image (fallback).

    Args:
        image: PIL Image object.

    Returns:
        Extracted text.
    """
    reader = _get_easyocr_reader()
    if reader is None:
        raise RuntimeError("EasyOCR is not available")

    # Convert PIL Image to bytes for easyocr
    img_bytes = io.BytesIO()
    image.save(img_bytes, format="PNG")
    img_bytes.seek(0)

    results = reader.readtext(img_bytes.getvalue(), detail=0)
    text = "\n".join(results)
    return clean_text(text, is_ocr=True)


def ocr_image(
    image: Optional[Image.Image] = None,
    image_bytes: Optional[bytes] = None,
    image_path: Optional[str] = None,
    language: str = "eng",
) -> tuple[str, float]:
    """
    Run OCR on an image using available engines.

    Tries Tesseract first, falls back to EasyOCR.

    Args:
        image: PIL Image object.
        image_bytes: Raw image bytes.
        image_path: Path to image file.
        language: OCR language code.

    Returns:
        Tuple of (extracted_text, confidence_score).
        Confidence is 0.0–1.0 based on text quality assessment.
    """
    if not settings.OCR_ENABLED:
        return "", 0.0

    # Load image if not provided directly
    if image is None:
        if image_bytes:
            image = Image.open(io.BytesIO(image_bytes))
        elif image_path:
            image = Image.open(image_path)
        else:
            raise ValueError("Provide image, image_bytes, or image_path")

    # Convert to RGB if needed (e.g., RGBA, palette)
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    # Try Tesseract first
    if _tesseract_available:
        try:
            text = ocr_image_tesseract(image, language=language)
            if text.strip():
                confidence = assess_text_quality(text)
                logger.info("ocr_success", engine="tesseract", text_length=len(text), confidence=confidence)
                return text, confidence
        except Exception as e:
            logger.warning("tesseract_failed", error=str(e))

    # Fallback to EasyOCR
    if _easyocr_available:
        try:
            text = ocr_image_easyocr(image)
            if text.strip():
                confidence = assess_text_quality(text)
                logger.info("ocr_success", engine="easyocr", text_length=len(text), confidence=confidence)
                return text, confidence
        except Exception as e:
            logger.warning("easyocr_failed", error=str(e))

    logger.warning("ocr_no_text_found")
    return "", 0.0


def ocr_pdf_page(
    pdf_path: Optional[str] = None,
    pdf_bytes: Optional[bytes] = None,
    page_number: int = 0,
    dpi: int = 300,
) -> str:
    """
    OCR a specific page of a PDF by rendering it as an image first.

    Args:
        pdf_path: Path to PDF file.
        pdf_bytes: Raw PDF bytes.
        page_number: Zero-indexed page number.
        dpi: Rendering resolution.

    Returns:
        OCR text from the page.
    """
    import fitz  # PyMuPDF

    if pdf_bytes:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    elif pdf_path:
        doc = fitz.open(pdf_path)
    else:
        raise ValueError("Provide pdf_path or pdf_bytes")

    try:
        if page_number >= len(doc):
            return ""

        page = doc[page_number]
        # Render page as image at specified DPI
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

        text, confidence = ocr_image(image=img)
        return text, confidence
    finally:
        doc.close()


def is_scanned_pdf(
    pdf_path: Optional[str] = None,
    pdf_bytes: Optional[bytes] = None,
    sample_pages: int = 3,
) -> bool:
    """
    Heuristic to detect if a PDF is mostly scanned (image-based).

    Checks if the first few pages have very little extractable text
    relative to their image content.

    Args:
        pdf_path: Path to PDF file.
        pdf_bytes: Raw PDF bytes.
        sample_pages: Number of pages to sample.

    Returns:
        True if the PDF appears to be scanned.
    """
    import fitz

    if pdf_bytes:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    elif pdf_path:
        doc = fitz.open(pdf_path)
    else:
        return False

    try:
        pages_to_check = min(sample_pages, len(doc))
        low_text_pages = 0

        for i in range(pages_to_check):
            page = doc[i]
            text = page.get_text("text").strip()
            images = page.get_images(full=True)

            # If a page has images but very little text, it's likely scanned
            if len(images) > 0 and len(text.split()) < 20:
                low_text_pages += 1

        return low_text_pages >= (pages_to_check * 0.6)
    finally:
        doc.close()
