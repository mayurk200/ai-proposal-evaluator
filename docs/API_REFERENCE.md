# API Reference

## Python AI Service (Port 8000)

Base URL: `http://localhost:8000/api/v1`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health check (LLM, Tesseract status) |
| `GET` | `/supported-formats` | List supported file formats and max size |
| `POST` | `/process-document` | Upload & process a document (extraction + chunking) |
| `POST` | `/evaluate` | Full evaluation pipeline (process + multi-agent evaluation) |
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

Passwords are hashed with Argon2id. Login/register return a 15-minute JWT
access token in the body and set a 30-day rotating refresh token in an
HttpOnly `SameSite=Lax` cookie scoped to `/api/auth`. Five failed logins lock
the account for 15 minutes; credential endpoints are also rate-limited per IP.
All auth events are recorded in `auth.audit_logs`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Register a new user (password: 12+ chars with upper/lower/number/symbol) |
| `POST` | `/auth/login` | Login → access token + refresh cookie |
| `POST` | `/auth/refresh` | Rotate the refresh cookie, mint a new access token |
| `POST` | `/auth/logout` | Revoke the current session (uses the refresh cookie) |
| `POST` | `/auth/logout-all` | Revoke all sessions for the current user (requires auth) |
| `GET` | `/auth/me` | Current user profile (requires auth; `/auth/profile` is a legacy alias) |
| `POST` | `/auth/change-password` | Change password; revokes all other sessions (requires auth) |
| `POST` | `/auth/forgot-password` | Request a password-reset token (response never reveals whether the email exists) |
| `POST` | `/auth/reset-password` | Reset password with a valid token; revokes all sessions |
| `GET` | `/auth/sessions` | List active sessions with IP/device (requires auth) |
| `DELETE` | `/auth/sessions/:id` | Revoke one session (requires auth) |

### Uploads & Evaluation (primary flow)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/uploads` | Upload one or many files to object storage (multipart, field `files`) |
| `GET` | `/uploads` | List everything currently in storage |
| `POST` | `/uploads/process` | Send stored files for extraction + agri categorization (`{ files: [{ key, name }] }`) |
| `GET` | `/uploads/processed` | List categorized proposals (`?category`, `?status`, `?page`, `?limit`) |
| `GET` | `/uploads/processed/:id` | Full record for one processed proposal |
| `POST` | `/uploads/processed/:id/evaluate` | Run the full multi-agent evaluation (`?force=true` re-runs) |
| `DELETE` | `/uploads/processed/:id` | Delete a proposal (DB row + stored files) |
| `GET` | `/uploads/categories` | Distinct agri categories with counts |

### Reports

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/reports` | List stored evaluation reports (`?page`, `?limit`, `?status`) |
| `POST` | `/reports/compare` | Parameter-level comparison of 2–5 reports (`{ reportIds: [] }`) |

### Proposals (legacy records)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/proposals` | List proposals (paginated) |
| `GET` | `/proposals/:id` | Get proposal details |
| `POST` | `/proposals/:id/claim` | Claim a proposal (requires auth) |
| `PATCH` | `/proposals/:id/reject` | Reject a proposal |
| `DELETE` | `/proposals/:id` | Delete a proposal |

### Settings

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/settings/schema` | Field registry driving the Settings UI (requires auth) |
| `GET` | `/settings` | Current effective settings (requires auth) |
| `PUT` | `/settings` | Update settings (admin) |
| `POST` | `/settings/reset` | Reset overrides to defaults (admin) |

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
| Settings | `/settings` | Profile, notifications, API config |
| About | `/about` | Platform & pipeline documentation |
| About Us | `/about-us` | Team and initiative background |
