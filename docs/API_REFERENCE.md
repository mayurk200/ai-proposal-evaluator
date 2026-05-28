# API Reference

## Python AI Service (Port 8000)

Base URL: `http://localhost:8000/api/v1`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health check (LLM, Tesseract status) |
| `GET` | `/supported-formats` | List supported file formats and max size |
| `POST` | `/process-document` | Upload & process a document (extraction + chunking) |
| `POST` | `/evaluate` | Full evaluation pipeline (process + 7 agents) |
| `POST` | `/evaluate-chunks` | Evaluate pre-processed chunks (no file upload) |

### POST /evaluate

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | ✅ | The document to evaluate |
| `run_ocr` | boolean | ❌ | Enable OCR for scanned content (default: `true`) |

**Response:**
```json
{
  "status": "success",
  "document_metadata": {
    "filename": "proposal.pdf",
    "format": "pdf",
    "total_pages": 12,
    "total_words": 5400,
    "total_chunks": 6,
    "has_scanned_content": false,
    "detected_sections": ["Executive Summary", "Technical Architecture", ...]
  },
  "evaluation": {
    "overall_score": 72,
    "problem_relevance_score": 80,
    "technical_score": 75,
    "financial_score": 55,
    "team_capability_score": 45,
    "pilot_design_score": 68,
    "market_potential_score": 62,
    "financial_sustainability_score": 50,
    "recommendation": "Conditionally Recommended",
    "summary": "...",
    "strengths": ["..."],
    "weaknesses": ["..."],
    "swot_analysis": { ... }
  },
  "agent_results": { ... },
  "processing_time_seconds": 42.5
}
```

---

## Node.js Backend (Port 3001)

Base URL: `http://localhost:3001/api`

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Register a new user |
| `POST` | `/auth/login` | Login and receive JWT token |
| `GET` | `/auth/profile` | Get current user profile (requires auth) |

### Proposals

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/proposals/evaluate-file` | Upload file → AI evaluation (primary endpoint) |
| `POST` | `/proposals/upload` | Upload proposal for storage |
| `GET` | `/proposals` | List all proposals (paginated) |
| `GET` | `/proposals/:id` | Get proposal details |
| `DELETE` | `/proposals/:id` | Delete a proposal |
| `POST` | `/proposals/:id/claim` | Claim a proposal (requires auth) |
| `PATCH` | `/proposals/:id/reject` | Reject a proposal |

### AI (Legacy)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/ai/evaluate` | Run AI evaluation (Node.js pipeline) |
| `POST` | `/ai/compare` | Compare two proposals |
| `GET` | `/ai/dashboard` | Dashboard statistics |

### Comparisons

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/comparisons` | List all comparisons |

---

## Scoring Weights

The Python 7-agent pipeline uses the following weights for the final score:

| Agent | Weight |
|---|---|
| Innovation | 15% |
| Market Potential | 15% |
| Technical | 15% |
| Financial | 15% |
| Feasibility | 15% |
| Risk | 10% |
| Sustainability | 5% |
| Compliance | 5% |
| Agriculture | 5% |

---

## Frontend Pages

| Page | Route | Description |
|---|---|---|
| Landing | `/` | Hero, features, workflow, testimonials |
| Login | `/login` | JWT authentication |
| Register | `/register` | User registration |
| Dashboard | `/dashboard` | Stats, charts, recent proposals, AI insights |
| Upload | `/upload` | Drag & drop with format validation |
| Proposals | `/proposals` | List with search & pagination |
| Proposal Detail | `/proposals/:id` | Scores, charts, SWOT, agent results |
| Compare | `/compare` | Side-by-side with radar & bar charts |
| Analytics | `/analytics` | Trends, distribution, categories |
| Settings | `/settings` | Profile, notifications, API config |
