# Testing Guide

## Overview

| Service | Framework | Tests |
|---|---|---|
| Python AI Service | pytest + pytest-cov | 359 |
| Node.js Backend | Vitest | 39 |
| **Total** | | **398** |

---

## Python Service Tests

### Running

```bash
cd python-service
source venv/bin/activate  # Windows: .\venv\Scripts\activate

# Run all tests
pytest tests/

# Run with coverage
pytest tests/ --cov=app --cov-report=term-missing

# Run a specific test file
pytest tests/test_new_components.py -v

# Run tests matching a pattern
pytest tests/ -k "test_debate"
```

### Test Files

| File | Module Under Test | Tests |
|---|---|---|
| `test_text_cleaning.py` | `utils/text_cleaning.py` | 52 |
| `test_chunker.py` | `services/processing/chunker.py` | 38 |
| `test_api_routes.py` | `api/routes.py` | 32 |
| `test_schemas.py` | `models/schemas.py` + `enums.py` | 25 |
| `test_text_extractor.py` | `services/extraction/text_extractor.py` | 24 |
| `test_storage.py` | `services/storage` | 22 |
| `test_ocr_engine.py` | `services/ocr/ocr_engine.py` | 19 |
| `test_base_agent.py` | `agents/base_agent.py` | 19 |
| `test_llm_client.py` | `services/llm/llm_client.py` | 17 |
| `test_database.py` | `db` layer | 17 |
| `test_format_support.py` | All format routing (PPT/PPTX/images) | 16 |
| `test_extractors.py` | `extraction/image_extractor.py` + `table_extractor.py` | 14 |
| `test_new_components.py` | 7 parameter agents, debate agent, form extraction | 12 |
| `test_chunk_router.py` | `agents/chunk_router` | 12 |
| `test_orchestrator.py` | `agents/orchestrator.py` | 8 |
| `test_summarizer.py` | `services/processing/summarizer.py` | 7 |
| `test_document_processor.py` | `processing/document_processor.py` | 6 |
| `test_table_extractor.py` | `extraction/table_extractor.py` | 5 |
| `test_config.py` | `config.py` | 5 |
| `test_batch_processor.py` | batch processing | 5 |
| `test_image_extractor.py` | `extraction/image_extractor.py` | 4 |

### Test Design

- **External APIs are mocked** — Groq, Tesseract, EasyOCR calls use `unittest.mock`
- **File I/O is mocked** — PyMuPDF, python-docx, python-pptx use mock objects
- **Real fitz is used for PDF tests** — `ocr_engine.py` and `image_extractor.py` create minimal PDFs with `fitz` for integration-level testing
- **FastAPI is tested with httpx** — `AsyncClient` + `ASGITransport` for zero-network-overhead API tests

### What's Not Covered

Most modules are now well-covered (>85%). Edge cases in extraction (corrupted files, malformed tables) and untested external network boundaries may still lack full coverage.

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
| `pythonProxy.test.ts` | `utils/pythonProxy.ts` | 10 |
| `localStore.test.ts` | `config/localStore.ts` | 20 |
| `formatSupport.test.ts` | `middleware/upload.ts` | 1 |

### Key Scenarios

- **Auth middleware**: Valid/invalid/expired JWT, missing Bearer prefix, optional auth passthrough
- **Python proxy**: Health checks, timeout handling, error propagation
- **Local store**: Full CRUD, `where` queries (==, !=, >, <, >=, <=, in, array-contains), `orderBy`, `limit`, `offset`, `count`, batch ops
- **Format support**: Upload middleware (multer) loads with the expected format allowlist

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
