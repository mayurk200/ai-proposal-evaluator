# Agent Evaluation Pipeline — Complete Documentation

## Architecture Overview

The system uses a **multi-agent pipeline** with **8 specialized LLM-powered agents** coordinated by an `AgentOrchestrator`. Each agent is a prompt-driven LLM call that returns structured JSON, strictly validated via Pydantic. The final scoring is performed deterministically in Python.

### Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STAGE 1: DOCUMENT INGESTION                      │
│                                                                     │
│  Upload (PDF/DOCX/PPTX/TXT/Images)                                │
│       ↓                                                             │
│  Document Processor (Text Extraction, OCR + Confidence Scoring)    │
│       ↓                                                             │
│  Strategic Chunking (financial / technical tags)                   │
│       ↓                                                             │
│  Output: DocumentChunks + Metadata + Summary                      │
└─────────────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    STAGE 2: EXTRACTION                              │
│                                                                     │
│  🔍 Extraction Agent (temp=0.1)                                    │
│       → Extracts 18 structured fields from raw text                │
│       → Output enriches ALL subsequent agents                      │
└─────────────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────────────┐
│            STAGE 3: ANALYSIS (7 Agents, Sequential)                │
│                                                                     │
│  🎯 Problem Relevance Agent     (20% weight)                      │
│  ⚙️ Technical Soundness Agent   (20% weight)                       │
│  📋 Pilot Design Agent          (15% weight)                       │
│  👥 Team & Execution Agent      (15% weight)                       │
│  📈 Market Potential Agent      (10% weight)                       │
│  💰 Financial Sustainability    (10% weight)                       │
│  🌍 Strategic Impact Agent      (10% weight)                       │
│                                                                     │
│  Each agent runs sequentially, extracting explicit evidence.       │
└─────────────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    STAGE 4: DETERMINISTIC SCORING                   │
│                                                                     │
│  🏆 Python Scoring Engine                                          │
│       → Computes weighted overall score                           │
│       → Determines risk level and investment readiness            │
│       → Automatic rejection based on thresholds/red flags         │
│       → Aggregates SWOT across all agents                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Stage 1 — Document Processing (Pre-Agent)

**Entry Point**: `POST /api/v1/evaluate`

**File**: `python-service/app/api/routes.py`

### Process

1. User uploads a file (PDF, DOCX, PPTX, images, etc.)
2. The document processor extracts raw text, runs OCR on scanned content (via Tesseract), and extracts tables/images.
3. **OCR Robustness**: An `ocr_confidence` score is computed based on alpha character ratios and heuristic line metrics. The extraction stages are wrapped in try/except blocks for graceful degradation.
4. Text is split into **strategic chunks** — each chunk is tagged with metadata:
   - `has_financial_data: bool` — chunks containing budget/cost/revenue data
   - `has_technical_content: bool` — chunks with technology/architecture details
   - `section_title`, `page_numbers`, `word_count`
5. An executive summary is generated
6. Output: `ProcessedDocument` with `chunks[]`, `metadata`, and `summary`

### Validation

- **Minimum text threshold**: If fewer than 20 words are extracted, the evaluation is rejected.
- **Global Timeouts**: Requests are protected by `asyncio.wait_for`.

---

## Stage 2 — Extraction Agent

**File**: `python-service/app/agents/extraction/extraction_agent.py`

| Setting | Value |
|---------|-------|
| Temperature | `0.1` (very deterministic — extracts facts, not opinions) |
| Validation | Pydantic `ExtractionOutputSchema` |

### Output Usage

The extracted data becomes **context enrichment** for all subsequent agents. It is prepended as `EXTRACTED PROPOSAL DATA` to each agent's input alongside the relevant proposal text.

---

## Stage 3 — Seven Analysis Agents

All 7 analysis agents evaluate specific parameters and generate scores, findings, red flags, and exact-quote evidence.

### Common Agent Behavior

Every agent inherits from `BaseAgent` (`python-service/app/agents/base_agent.py`):

- Uses robust API client with `tenacity` retries.
- Strictly validates output using `app.agents.validation`.
- If LLM completely fails, validator falls back to a degraded "failed" result rather than crashing.

**Key output fields**:
- `score` (0-100)
- `confidence` (0.0-1.0)
- `evidence`: List of `EvidenceItem` (claim, source section, exact quote)
- `missing_information`: List of missing data impacting the score.
- `DO NOT EVALUATE` rules prevent overlap between agents.

### Content Routing

- **Technical Agent** → receives only chunks tagged with `has_technical_content`
- **Financial Agent** → receives only chunks tagged with `has_financial_data`
- **All other agents** → receive the full content

---

## Stage 4 — Deterministic Scoring Engine

The Final Scoring LLM agent was replaced with a deterministic Python engine (`app.agents.orchestrator.AgentOrchestrator._compute_deterministic_evaluation`).

### Weighted Scoring Formula

```
Overall Score = 
    Problem Relevance        × 0.20
  + Technical Soundness      × 0.20
  + Pilot Design             × 0.15
  + Team Capability          × 0.15
  + Market Potential         × 0.10
  + Financial Sustainability × 0.10
  + Strategic Impact         × 0.10
  ─────────────────────────────────
                              = 1.00
```

### Recommendation Enforcement

The recommendation is purely logic-driven:
- **Select**: Overall score >= 75 AND no individual agent < 40 AND total red flags < 5.
- **Reject**: Otherwise.

### Confidence Degradation

The pipeline automatically reduces its overall `confidence` score if:
- Document length is too short.
- The `ocr_confidence` from Stage 1 is low (e.g. < 0.5).
- Any agent timed out or failed.

---

## LLM Infrastructure & Resilience

**File**: `python-service/app/services/llm/llm_client.py`

| Defense Layer | Description |
|---------------|-------------|
| **Retries** | 5 attempts with exponential backoff on HTTP 500/502/503. |
| **Timeouts** | 45s strict timeout per LLM API call. |
| **JSON Repair** | Brace-matching extraction and fallback handling for truncated responses or trailing commas. |
| **Validation** | Pydantic strict schemas ensuring no hallucinated fields. |

---

## File Reference

| File | Purpose |
|------|---------|
| `app/agents/orchestrator.py` | Pipeline coordinator, weighted scoring |
| `app/agents/base_agent.py` | Base class for all agents |
| `app/agents/validation.py` | Strict Pydantic validation & defaults |
| `app/services/llm/llm_client.py` | Robust LLM client (retries, timeouts, JSON parsing) |
| `app/models/schemas.py` | Core data models (`EvidenceItem`, etc.) |
| `app/services/processing/document_processor.py` | Pipeline for text/OCR extraction |
| `app/api/routes.py` | Hardened FastAPI endpoints |
| `tests/test_scoring_engine.py` | Unit tests for deterministic logic |
