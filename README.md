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
  <img src="https://img.shields.io/badge/Tests-319_passing-brightgreen?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/Coverage-92%25-brightgreen?style=flat-square" alt="Coverage" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License" />
</p>

---

A production-grade platform that evaluates agriculture startup proposals using **7 specialized AI agents** powered by Groq (LLaMA 3.3 70B). Upload a PDF, PPTX, DOCX, or image — the system extracts text (with OCR for scanned documents), chunks it intelligently, and runs a multi-agent evaluation pipeline that scores the proposal across problem relevance, technical soundness, team capability, market potential, and more.

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
          6. 7 AI agents evaluate sequentially
          7. Weighted final score + SWOT analysis
                    │
                    ▼
          Results rendered: scores, charts, recommendations
```

## Features

- **Multi-format support** — PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG, JPEG, TIFF, BMP
- **Intelligent OCR** — Detects scanned PDFs and images, applies Tesseract with EasyOCR fallback
- **7-agent AI pipeline** — Problem Relevance, Technical Soundness, Pilot Design, Team Capability, Market Potential, Financial Sustainability, Strategic Impact
- **Section-aware chunking** — Splits on headings, not arbitrary token counts
- **SWOT analysis** — Auto-generated strengths, weaknesses, opportunities, threats
- **Radar & bar charts** — Visual score breakdowns with Recharts
- **JWT authentication** — Register, login, claim proposals
<!-- - **Comparison view** — Side-by-side evaluation of multiple proposals -->
- **Resilient fallback** — If Python service is down, Node.js runs a 4-agent fallback pipeline (will be removed soon and only python service will be used by making it fault tolerant)

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
| **Database** | Firebase Firestore (or local JSON fallback) |
| **Auth** | JWT + bcrypt |
| **Testing** | pytest (Python), Vitest (Node.js) — 319 tests |

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
# Python service — 271 tests, 92% coverage
cd python-service
source venv/bin/activate
pytest tests/ --cov=app --cov-report=term-missing

# Node.js backend — 49 tests
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

## AI Agents*

| # | Agent | What It Evaluates |
|---|---|---|
| 1 | **Problem Relevance** | Understanding of agricultural challenges and problem validation |
| 2 | **Technical Soundness** | Architecture, methodology, tech stack, and scalability |
| 3 | **Pilot Design** | Validation strategy, implementation plan, and timeline realism |
| 4 | **Team Capability** | Skills, relevant experience, and execution readiness |
| 5 | **Market Potential** | Target market size, competitive landscape, and distribution |
| 6 | **Financial Sustainability** | Business model, revenue streams, and unit economics |
| 7 | **Strategic Impact** | Long-term vision, ecosystem benefits, and alignment |

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Python service health check |
| `GET` | `/api/v1/supported-formats` | List supported file formats |
| `POST` | `/api/v1/process-document` | Extract & chunk a document |
| `POST` | `/api/v1/evaluate` | Full evaluation pipeline |
| `POST` | `/api/proposals/evaluate-file` | Upload + evaluate (via backend) |
| `POST` | `/api/auth/register` | Register user |
| `POST` | `/api/auth/login` | Login user |
| `GET` | `/api/proposals` | List proposals |
| `GET` | `/api/proposals/:id` | Get proposal detail |

## Docker

```bash
docker-compose up --build
```

> Set `GROQ_API_KEY` in a root `.env` file or pass via environment variables.

## Documentation

| Document | Description |
|---|---|
| [QUICKSTART.md](docs/QUICKSTART.md) | Step-by-step setup with screenshots and troubleshooting |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow diagrams, scoring weights, file structure |

## Project Structure

```
ai-proposal-evaluator/
├── frontend/              React + Vite + TailwindCSS v4
├── backend/               Node.js + Express + TypeScript
├── python-service/        FastAPI + 7 AI agents + OCR
├── docs/                  Architecture & quickstart guides
├── scripts/               Utility scripts
└── docker-compose.yml     Full-stack containerization
```