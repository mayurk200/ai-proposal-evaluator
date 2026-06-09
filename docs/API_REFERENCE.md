# API Reference

## Python AI Service (Port 8000)

Base URL: `http://localhost:8000/api/v1`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health check (LLM, Tesseract status) |
| `GET` | `/supported-formats` | List supported file formats and max size |
| `POST` | `/process-document` | Upload & process a document (extraction + chunking) |
| `POST` | `/evaluate` | Full evaluation pipeline (process + 9 agents) |
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
    "detected_sections": ["Executive Summary", "Problem Statement", "Pilot Implementation"]
  },
  "evaluation": {
    "overall_score": 72,
    "problem_relevance_score": 80,
    "solution_readiness_score": 75,
    "pilot_design_score": 68,
    "farmer_adoption_score": 70,
    "scale_up_score": 65,
    "team_capacity_score": 78,
    "compliance_score": 68,
    "recommendation": "Recommended",
    "summary": "...",
    "strengths": ["..."],
    "weaknesses": ["..."],
    "swot_analysis": {
      "strengths": ["..."],
      "weaknesses": ["..."],
      "opportunities": ["..."],
      "threats": ["..."]
    },
    "parameter_breakdown": {
      "problem_relevance": {
        "parameter_name": "Problem Relevance",
        "parameter_score": 80.0,
        "sub_questions": [
          {
            "question_id": "pr_1",
            "question": "...",
            "score": 8,
            "justification": "...",
            "evidence": "..."
          }
        ],
        "key_findings": ["..."],
        "red_flags": [],
        "recommendations": ["..."]
      }
    },
    "debate_summary": {
      "confidence": 0.9,
      "conflicts": [
        {
          "conflict_id": "c1",
          "parameter": "Problem Relevance",
          "severity": "medium",
          "description": "..."
        }
      ],
      "debates": [
        {
          "conflict_id": "c1",
          "topic": "...",
          "position_a": {
            "agent": "...",
            "argument": "...",
            "evidence": "..."
          },
          "position_b": {
            "agent": "...",
            "argument": "...",
            "evidence": "..."
          },
          "resolution": "...",
          "score_adjustments": []
        }
      ],
      "high_ambiguity_areas": ["..."]
    }
  },
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

## Scoring & Rubric System

The Python service evaluates proposals against the 7 AIAIC parameters. The final overall score is a flat average of the 7 parameter scores:

| Parameter | Weight | Description |
|---|---|---|
| Problem Relevance | 14.28% | Farming challenges, direct farmer pain points |
| Solution Readiness | 14.28% | Technology Readiness Level (TRL 5-9) and innovativeness |
| Pilot Design | 14.28% | Schedule, milestones, and testing scope viability |
| Farmer Adoption | 14.28% | Incentives, usability, and youth/gender parity |
| Scale-up Potential | 14.28% | Revenue streams and market scale strategy |
| Team Capacity | 14.28% | Technical, agronomic, and business experience |
| Compliance | 14.28% | Regulations, environmental certifications, standards |

Each parameter is calculated as the average score of its sub-questions (on a 1 to 10 scale) multiplied by 10. High-severity scoring conflicts trigger the Debate Agent, which applies score adjustments.

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
