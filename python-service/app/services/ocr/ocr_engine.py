"""
OCR engine.

Three changes from the previous version, in order of how much they matter:

1. **Preprocessing.** Raw page renders were fed straight to Tesseract. Scanned
   application forms are skewed, noisy and unevenly lit, and Tesseract is very
   sensitive to all three. Deskew + denoise + adaptive binarize before OCR is the
   single largest accuracy win available here, and it costs milliseconds.

2. **Parallel pages.** Scanned PDFs were OCR'd one page at a time, re-opening the
   PDF from bytes for *every* page, on the event loop. A 20-page scan re-parsed
   the document 20 times and blocked everything else while doing it. Now the doc
   is opened once, pages are rendered once, and OCR runs across a bounded thread
   pool.

3. **Confidence.** Tesseract can tell us how sure it is. We use that to decide
   whether to fall back to EasyOCR, instead of the old test of "did it return any
   characters at all" — which happily accepted a page of confident garbage.
"""

from __future__ import annotations

import asyncio
import io
from typing import Optional

import numpy as np
from PIL import Image

from app.config import settings
from app.utils.logging import get_logger
from app.utils.text_cleaning import clean_text

logger = get_logger(__name__)

_tesseract_available = False
_easyocr_available = False

try:
    import pytesseract

    if settings.TESSERACT_CMD:
        pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD
    pytesseract.get_tesseract_version()
    _tesseract_available = True
    logger.info("tesseract_available", version=str(pytesseract.get_tesseract_version()))
except Exception as exc:
    logger.warning("tesseract_unavailable", error=str(exc))

try:
    import easyocr  # noqa: F401

    _easyocr_available = True
    logger.info("easyocr_available")
except ImportError:
    logger.warning("easyocr_unavailable")

_easyocr_reader = None

# Below this mean confidence we do not trust Tesseract's output and try EasyOCR.
MIN_CONFIDENCE = 55.0


def _get_easyocr_reader():
    """Lazy — loading the EasyOCR model is seconds and megabytes."""
    global _easyocr_reader
    if _easyocr_reader is None and _easyocr_available:
        import easyocr

        _easyocr_reader = easyocr.Reader([settings.OCR_LANGUAGE[:2]], gpu=False)
    return _easyocr_reader


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------


def preprocess_for_ocr(image: Image.Image) -> Image.Image:
    """
    Clean an image up before OCR: grayscale -> denoise -> deskew -> binarize.

    Every step here exists because scanned proposals routinely arrive as phone
    photos or crooked flatbed scans. Tesseract's accuracy falls off a cliff past
    about 2 degrees of skew, so straightening the page is not cosmetic.

    Falls back to the original image if OpenCV is unavailable or anything throws —
    a preprocessing failure should degrade OCR quality, never break extraction.
    """
    try:
        import cv2
    except ImportError:  # pragma: no cover
        return image

    try:
        if image.mode != "RGB":
            image = image.convert("RGB")

        array = np.array(image)
        gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)

        # Denoise while keeping edges — text strokes are edges.
        gray = cv2.fastNlMeansDenoising(gray, h=10, templateWindowSize=7, searchWindowSize=21)

        # Deskew: find the dominant text angle from the minimum-area rectangle
        # around the dark pixels.
        coords = np.column_stack(np.where(gray < 200))
        if coords.size > 0:
            angle = cv2.minAreaRect(coords.astype(np.float32))[-1]
            # OpenCV reports the angle in [-90, 0); normalize to a small rotation.
            if angle < -45:
                angle = 90 + angle
            # Only correct a genuine skew. Rotating by a fraction of a degree just
            # resamples the image and loses detail for nothing.
            if abs(angle) > 0.5:
                h, w = gray.shape
                matrix = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
                gray = cv2.warpAffine(
                    gray,
                    matrix,
                    (w, h),
                    flags=cv2.INTER_CUBIC,
                    borderMode=cv2.BORDER_REPLICATE,
                )
                logger.debug("ocr_deskewed", angle=round(float(angle), 2))

        # Adaptive threshold beats a global one when the scan is unevenly lit —
        # which a photographed document always is.
        binarized = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
        )

        return Image.fromarray(binarized)

    except Exception as exc:
        logger.warning("ocr_preprocess_failed", error=str(exc))
        return image


# ---------------------------------------------------------------------------
# Engines
# ---------------------------------------------------------------------------


def _ocr_tesseract(image: Image.Image, language: str) -> tuple[str, float]:
    """Run Tesseract and report its mean confidence over recognised words."""
    if not _tesseract_available:
        raise RuntimeError("Tesseract is not available")

    import pytesseract

    data = pytesseract.image_to_data(
        image, lang=language, output_type=pytesseract.Output.DICT
    )

    words: list[str] = []
    confidences: list[float] = []
    for text, conf in zip(data["text"], data["conf"]):
        text = (text or "").strip()
        try:
            conf_value = float(conf)
        except (TypeError, ValueError):
            continue
        # Tesseract emits -1 for boxes it found but could not read.
        if text and conf_value >= 0:
            words.append(text)
            confidences.append(conf_value)

    if not words:
        return "", 0.0

    mean_conf = sum(confidences) / len(confidences)
    return clean_text(" ".join(words), is_ocr=True), mean_conf


def _ocr_easyocr(image: Image.Image) -> str:
    reader = _get_easyocr_reader()
    if reader is None:
        raise RuntimeError("EasyOCR is not available")

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    results = reader.readtext(buffer.getvalue(), detail=0)
    return clean_text("\n".join(results), is_ocr=True)


def ocr_image(
    image: Optional[Image.Image] = None,
    image_bytes: Optional[bytes] = None,
    image_path: Optional[str] = None,
    language: Optional[str] = None,
    preprocess: bool = True,
) -> str:
    """
    OCR one image. Tesseract first; EasyOCR when Tesseract is absent, fails, or
    comes back with low confidence.

    Synchronous and CPU-bound by design — callers push it to a thread.
    """
    if not settings.OCR_ENABLED:
        return ""

    language = language or settings.OCR_LANGUAGE

    if image is None:
        if image_bytes:
            image = Image.open(io.BytesIO(image_bytes))
        elif image_path:
            image = Image.open(image_path)
        else:
            raise ValueError("Provide image, image_bytes, or image_path")

    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    prepared = preprocess_for_ocr(image) if preprocess else image

    tesseract_text = ""
    if _tesseract_available:
        try:
            tesseract_text, confidence = _ocr_tesseract(prepared, language)
            if tesseract_text and confidence >= MIN_CONFIDENCE:
                logger.info(
                    "ocr_success",
                    engine="tesseract",
                    confidence=round(confidence, 1),
                    chars=len(tesseract_text),
                )
                return tesseract_text
            logger.info(
                "ocr_low_confidence",
                engine="tesseract",
                confidence=round(confidence, 1),
            )
        except Exception as exc:
            logger.warning("tesseract_failed", error=str(exc))

    if _easyocr_available:
        try:
            text = _ocr_easyocr(prepared)
            if text.strip():
                logger.info("ocr_success", engine="easyocr", chars=len(text))
                return text
        except Exception as exc:
            logger.warning("easyocr_failed", error=str(exc))

    # Low-confidence Tesseract output still beats nothing, if EasyOCR gave us
    # nothing better.
    if tesseract_text:
        return tesseract_text

    logger.warning("ocr_no_text_found")
    return ""


# ---------------------------------------------------------------------------
# PDF pages
# ---------------------------------------------------------------------------


def render_pdf_pages(
    pdf_bytes: Optional[bytes] = None,
    pdf_path: Optional[str] = None,
    dpi: Optional[int] = None,
    page_numbers: Optional[list[int]] = None,
) -> list[tuple[int, Image.Image]]:
    """
    Render PDF pages to images, opening the document exactly once.

    The old code re-opened the PDF from bytes on every single page — O(pages)
    full document parses for one scan.
    """
    import fitz

    dpi = dpi or settings.OCR_DPI

    if pdf_bytes:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    elif pdf_path:
        doc = fitz.open(pdf_path)
    else:
        raise ValueError("Provide pdf_bytes or pdf_path")

    try:
        targets = page_numbers if page_numbers is not None else range(len(doc))
        matrix = fitz.Matrix(dpi / 72, dpi / 72)

        rendered: list[tuple[int, Image.Image]] = []
        for page_num in targets:
            if page_num >= len(doc):
                continue
            pixmap = doc[page_num].get_pixmap(matrix=matrix)
            image = Image.frombytes(
                "RGB", (pixmap.width, pixmap.height), pixmap.samples
            )
            rendered.append((page_num, image))
        return rendered
    finally:
        doc.close()


async def ocr_pdf_pages(
    pdf_bytes: Optional[bytes] = None,
    pdf_path: Optional[str] = None,
    dpi: Optional[int] = None,
) -> dict[int, str]:
    """
    OCR every page of a scanned PDF, in parallel, off the event loop.

    Rendering and OCR are both CPU-bound, so they go to threads; the semaphore
    keeps a 200-page scan from spawning 200 of them. Returns {page_number: text}.
    A page that fails OCR yields "" rather than sinking the whole document.
    """
    if not settings.OCR_ENABLED:
        return {}

    pages = await asyncio.to_thread(
        render_pdf_pages, pdf_bytes=pdf_bytes, pdf_path=pdf_path, dpi=dpi
    )
    if not pages:
        return {}

    semaphore = asyncio.Semaphore(settings.OCR_MAX_WORKERS)

    async def run(page_num: int, image: Image.Image) -> tuple[int, str]:
        async with semaphore:
            try:
                text = await asyncio.to_thread(ocr_image, image=image)
                return page_num, text
            except Exception as exc:
                logger.warning("ocr_page_failed", page=page_num, error=str(exc))
                return page_num, ""

    results = await asyncio.gather(*(run(n, img) for n, img in pages))

    ocr_by_page = {page: text for page, text in results if text.strip()}
    logger.info(
        "pdf_ocr_completed", pages=len(pages), pages_with_text=len(ocr_by_page)
    )
    return ocr_by_page


def ocr_pdf_page(
    pdf_path: Optional[str] = None,
    pdf_bytes: Optional[bytes] = None,
    page_number: int = 0,
    dpi: Optional[int] = None,
) -> str:
    """Single-page OCR. Retained for callers that genuinely want just one page."""
    pages = render_pdf_pages(
        pdf_bytes=pdf_bytes, pdf_path=pdf_path, dpi=dpi, page_numbers=[page_number]
    )
    if not pages:
        return ""
    return ocr_image(image=pages[0][1])


def is_scanned_pdf(
    pdf_path: Optional[str] = None,
    pdf_bytes: Optional[bytes] = None,
    sample_pages: int = 5,
) -> bool:
    """
    Decide whether a PDF needs full-page OCR.

    A page counts as "scanned" if it carries images but almost no extractable
    text. Sampling five pages rather than three, because AIAIC submissions often
    open with a native-text cover page or two in front of a scanned body — and the
    old 3-page sample classified those documents as digital and skipped OCR
    entirely, silently losing the whole scanned section.
    """
    import fitz

    if pdf_bytes:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    elif pdf_path:
        doc = fitz.open(pdf_path)
    else:
        return False

    try:
        if len(doc) == 0:
            return False

        # Sample across the document, not just the front of it.
        total = len(doc)
        step = max(1, total // sample_pages)
        indices = list(range(0, total, step))[:sample_pages]

        low_text_pages = 0
        for i in indices:
            page = doc[i]
            words = len(page.get_text("text").split())
            has_images = bool(page.get_images(full=True))
            if has_images and words < 20:
                low_text_pages += 1

        return low_text_pages >= len(indices) * 0.6
    finally:
        doc.close()
