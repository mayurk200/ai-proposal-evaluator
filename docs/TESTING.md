# Testing Guide

## Overview

| Service | Framework | Tests | Coverage |
|---|---|---|---|
| Python AI Service | pytest + pytest-cov | 259 | 83% |
| Node.js Backend | Vitest | 49 | — |
| **Total** | | **308** | |

---

## Python Service Tests

### Running

```bash
cd python-service
source venv/bin/activate

# Run all tests
pytest tests/

# Run with coverage
pytest tests/ --cov=app --cov-report=term-missing

# Run a specific test file
pytest tests/test_chunker.py -v

# Run tests matching a pattern
pytest tests/ -k "test_routes_pptx"
```

### Test Files

| File | Module Under Test | Tests | Coverage |
|---|---|---|---|
| `test_text_cleaning.py` | `utils/text_cleaning.py` | 50 | 99% |
| `test_schemas.py` | `models/schemas.py` + `enums.py` | 25 | 100% |
| `test_config.py` | `config.py` | 5 | 100% |
| `test_llm_client.py` | `services/llm/llm_client.py` | 15 | 89% |
| `test_chunker.py` | `services/processing/chunker.py` | 22 | 96% |
| `test_base_agent.py` | `agents/base_agent.py` | 12 | 100% |
| `test_orchestrator.py` | `agents/orchestrator.py` | 6 | 88% |
| `test_summarizer.py` | `services/processing/summarizer.py` | 6 | 100% |
| `test_api_routes.py` | `api/routes.py` | 10 | 82% |
| `test_text_extractor.py` | `services/extraction/text_extractor.py` | 15 | 95% |
| `test_ocr_engine.py` | `services/ocr/ocr_engine.py` | 17 | 87% |
| `test_extractors.py` | `extraction/image_extractor.py` + `table_extractor.py` | 12 | 47%/32% |
| `test_document_processor.py` | `processing/document_processor.py` | 6 | 91% |
| `test_format_support.py` | All format routing (PPT/PPTX/images) | 16 | — |

### Test Design

- **External APIs are mocked** — Groq, Tesseract, EasyOCR calls use `unittest.mock`
- **File I/O is mocked** — PyMuPDF, python-docx, python-pptx use mock objects
- **Real fitz is used for PDF tests** — `ocr_engine.py` and `image_extractor.py` create minimal PDFs with `fitz` for integration-level testing
- **FastAPI is tested with httpx** — `AsyncClient` + `ASGITransport` for zero-network-overhead API tests

### What's Not Covered

| Module | Coverage | Why |
|---|---|---|
| `image_extractor.py` (DOCX/PPTX paths) | 47% | Requires real Office files with embedded images |
| `table_extractor.py` (DOCX/PPTX paths) | 32% | Requires real Office files with tables |
| `http_client.py` | 0% | Unused utility module |

---

## Node.js Backend Tests

### Running

```bash
cd backend

# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run a specific test file
npx vitest run tests/auth.test.ts
```

### Test Files

| File | Module Under Test | Tests |
|---|---|---|
| `auth.test.ts` | `middleware/auth.ts` | 8 |
| `pythonProxy.test.ts` | `utils/pythonProxy.ts` | 11 |
| `localStore.test.ts` | `config/localStore.ts` | 20 |
| `formatSupport.test.ts` | `middleware/upload.ts` + `utils/textExtractor.ts` | 10 |

### Key Scenarios

- **Auth middleware**: Valid/invalid/expired JWT, missing Bearer prefix, optional auth passthrough
- **Python proxy**: Response mapping, health checks, timeout handling, error propagation
- **Local store**: Full CRUD, `where` queries (==, !=, >, <, >=, <=, in, array-contains), `orderBy`, `limit`, `offset`, `count`, batch ops
- **Format support**: PPT/PPTX/image MIME types accepted by multer, descriptive errors for Python-only formats in Node.js fallback

---

## Adding New Tests

### Python

1. Create `tests/test_<module>.py`
2. Use `@patch` for external dependencies
3. Use `conftest.py` factories (`make_chunk`, `make_metadata`)
4. Mark async tests with `@pytest.mark.asyncio`

### Node.js

1. Create `tests/<module>.test.ts`
2. Use `vi.fn()` / `vi.mock()` for mocks
3. The `tests/setup.ts` file pre-configures environment variables
4. Run with `npx vitest run tests/<file>.test.ts`
