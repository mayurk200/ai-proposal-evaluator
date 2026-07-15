<p align="center">
  <h1 align="center">AgriEval</h1>
  <p align="center">AI-Powered Agriculture Startup Proposal Evaluation Platform</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/TailwindCSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="TailwindCSS" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/FastAPI-Python_3.11-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/LLM-Groq_LLaMA_3.3_70B-F55036?style=flat-square&logo=meta&logoColor=white" alt="Groq" />
  <img src="https://img.shields.io/badge/Tests-398_passing-brightgreen?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License" />
</p>

---

A platform that evaluates agriculture startup proposals using a **multi-agent AI pipeline** powered by Groq (LLaMA 3.3 70B). Upload a PDF, PPTX, DOCX, or image — the system extracts text (with OCR for scanned documents), chunks it intelligently, and scores the proposal against the 7 AIAIC parameters: Problem Relevance, Solution Readiness, Pilot Design, Farmer Adoption, Scale-up Potential, Team Capacity, and Compliance.

## How It Works

```
User uploads file → Node.js Backend → Python AI Service
                                           │
                    ┌──────────────────────┘
                    ▼
          1. Text Extraction (PDF / DOCX / PPTX / TXT / Image)
          2. OCR for scanned pages & images (Tesseract / EasyOCR)
          3. Table & image extraction
          4. Section-aware strategic chunking
          5. Executive summary generation (LLM)
          6. 7 parameter agents evaluate (AIAIC rubric)
          7. Debate agent resolves scoring conflicts
          8. Scoring agent → final score + SWOT analysis
                    │
                    ▼
          Results rendered: scores, charts, recommendations
```

## Features

- **Multi-format support** — PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG, JPEG, TIFF, BMP
- **Intelligent OCR** — Detects scanned PDFs and images, applies Tesseract with EasyOCR fallback
- **Multi-agent AI pipeline** — Extraction, 7 AIAIC parameter agents, Debate, Scoring (plus a Categorization agent at intake)
- **Section-aware chunking** — Splits on headings, not arbitrary token counts
- **SWOT analysis** — Auto-generated strengths, weaknesses, opportunities, threats
- **Radar & bar charts** — Visual score breakdowns with Recharts
- **Hardened authentication** — Argon2id password hashing, rotating refresh-token sessions (HttpOnly cookies), account lockout, audit logging, session management
- **Report comparison** — Parameter-level comparison of 2–5 evaluation reports

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite 8, TypeScript, TailwindCSS v4, Framer Motion |
| **State** | Zustand, TanStack Query |
| **Charts** | Recharts |
| **Backend** | Node.js, Express, TypeScript |
| **AI Service** | Python 3.11, FastAPI, Pydantic |
| **LLM** | Groq API — LLaMA 3.3 70B Versatile |
| **OCR** | Tesseract + EasyOCR (auto-fallback) |
| **Document Processing** | PyMuPDF, python-docx, python-pptx |
| **Database** | PostgreSQL (Docker; local JSON fallback for zero-config dev) |
| **Object Storage** | MinIO (S3-compatible, Docker) |
| **Auth** | JWT (15-min access) + rotating refresh cookies + Argon2id |
| **Testing** | pytest (Python), Vitest (Node.js) — 398 tests |

## Run the App

### Fastest — one command (Windows)

From the repo root, double-click **`run.cmd`** (or run it from a terminal):

```bat
run.cmd
```

This launches the whole stack in order and opens the app in your browser:

1. Starts Docker Desktop (if not already running)
2. Brings up PostgreSQL + MinIO containers (with health checks)
3. Starts the Python AI service → http://localhost:8000
4. Starts the Node backend → http://localhost:3001
5. Starts the React frontend → http://localhost:5173

Under the hood it runs `scripts\dev.ps1`, which verifies prerequisites, self-heals the Postgres password, validates/recreates the Python venv (uv, Python 3.11), installs any missing `node_modules`, and health-gates each service on the previous one. You can also run it directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

**Stop everything:** `scripts\stop.ps1`

Open http://localhost:5173 → Register → Upload a proposal → click **Evaluate**.

> Full run order, per-service health verification, and troubleshooting: **[docs/RUN.md](docs/RUN.md)**. First-time setup and `.env` layout: **[docs/setup.md](docs/setup.md)**.

### Manual setup

If you prefer to start each service yourself, follow the steps below.

## Quick Setup

### Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | ≥ 18 | `node --version` |
| Python | ≥ 3.10 | `python3 --version` |
| Tesseract OCR | ≥ 4.0 | `tesseract --version` |
| Groq API Key | — | [console.groq.com/keys](https://console.groq.com/keys) |

```bash
# Install Tesseract (Ubuntu/Debian)
sudo apt update && sudo apt install -y tesseract-ocr tesseract-ocr-eng poppler-utils

# macOS
brew install tesseract poppler
```

### 1. Python AI Service (Port 8000)

```bash
cd python-service
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit .env → set GROQ_API_KEY=gsk_your_key_here

# Start
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Verify: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health) — should show `"status": "ok"`

### 2. Node.js Backend (Port 3001)

```bash
cd backend
npm install

# Configure
cp .env.example .env
# Edit .env → set GROQ_API_KEY and JWT_SECRET

# Start
npm run dev
```

### 3. React Frontend (Port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) → Register → Upload a proposal → Click **Evaluate**.

### Environment Variables

**Backend** (`backend/.env`)
```env
JWT_SECRET=your-secret-key-min-10-chars
GROQ_API_KEY=gsk_your_groq_api_key
PYTHON_SERVICE_URL=http://localhost:8000
PORT=3001
```

**Python Service** (`python-service/.env`)
```env
GROQ_API_KEY=gsk_your_groq_api_key
LLM_MODEL=llama-3.3-70b-versatile
```

**Frontend** (`frontend/.env`)
```env
VITE_API_URL=http://localhost:3001/api
```

## Running Tests

```bash
# Python service — 359 tests
cd python-service
source venv/bin/activate          # Windows: venv\Scripts\activate
pytest tests/ --cov=app --cov-report=term-missing

# Node.js backend — 39 tests
cd backend
npm test
```

## Supported File Formats

| Format | Extension | Processing |
|---|---|---|
| PDF | `.pdf` | PyMuPDF text extraction + OCR for scanned pages |
| Word | `.docx`, `.doc` | python-docx with heading/table detection |
| PowerPoint | `.pptx`, `.ppt` | python-pptx with slide-by-slide extraction |
| Plain Text | `.txt` | Direct read |
| Images | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp` | Full OCR via Tesseract/EasyOCR |

## AI Agents

| # | Agent | Role |
|---|---|---|
| 1 | **Categorization** | Agri category detection at intake (process step) |
| 2 | **Extraction** | Structured data: team, funding, timeline, market |
| 3 | **Problem Relevance** | Farming challenges, direct farmer pain points |
| 4 | **Solution Readiness** | Technology Readiness Level (TRL 5–9), innovativeness |
| 5 | **Pilot Design** | Schedule, milestones, testing scope viability |
| 6 | **Farmer Adoption** | Incentives, usability, youth/gender parity |
| 7 | **Scale-up Potential** | Revenue streams, market scale strategy |
| 8 | **Team Capacity** | Technical, agronomic, and business experience |
| 9 | **Compliance** | Regulations, environmental certifications, standards |
| 10 | **Debate** | Resolves high-severity scoring conflicts between agents |
| 11 | **Scoring** | Final score synthesis, recommendation, SWOT |

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Python service health check |
| `GET` | `/api/v1/supported-formats` | List supported file formats |
| `POST` | `/api/v1/process-document` | Extract & chunk a document |
| `POST` | `/api/v1/evaluate` | Full evaluation pipeline |
| `POST` | `/api/uploads` | Upload files to object storage (via backend) |
| `POST` | `/api/uploads/process` | Extract + categorize stored files |
| `POST` | `/api/uploads/processed/:id/evaluate` | Run the full multi-agent evaluation |
| `POST` | `/api/auth/register` | Register user |
| `POST` | `/api/auth/login` | Login user |
| `GET` | `/api/reports` | List evaluation reports |

> Full endpoint list: [docs/API_REFERENCE.md](docs/API_REFERENCE.md)

## Docker

```bash
docker-compose up --build
```

> Set `GROQ_API_KEY` in a root `.env` file or pass via environment variables.

## Documentation

| Document | Description |
|---|---|
| [setup.md](docs/setup.md) | **Local dev setup** — prerequisites, .env layout, one-command startup (`scripts\dev.ps1`), troubleshooting |
| [RUN.md](docs/RUN.md) | Full-stack run order and per-service health verification |
| [QUICKSTART.md](docs/QUICKSTART.md) | Step-by-step setup with screenshots and troubleshooting |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow diagrams, scoring weights, file structure |
| [API_REFERENCE.md](docs/API_REFERENCE.md) | All backend + Python service endpoints, scoring rubric, frontend pages |
| [ranking.md](docs/ranking.md) | How the proposal triage rank (0–100) is produced and how the Rankings view orders proposals |

## Project Structure

```
ai-proposal-evaluator/
├── frontend/              React + Vite + TailwindCSS v4
├── backend/               Node.js + Express + TypeScript
├── python-service/        FastAPI + multi-agent pipeline + OCR
├── docs/                  Architecture & quickstart guides
├── scripts/               Utility scripts
└── docker-compose.yml     Full-stack containerization
```