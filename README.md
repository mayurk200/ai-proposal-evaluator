# AgriEval — AI-Powered Agriculture Startup Proposal Evaluation Platform

A production-grade platform that evaluates agriculture startup proposals using seven specialized AI agents powered by Groq (LLaMA 3.3 70B).

## Architecture

```
├── backend/          # Node.js + Express + TypeScript
│   └── src/
│       ├── config/   # Env, database config
│       ├── middleware/ # Auth, upload, error handling
│       ├── modules/
│       │   ├── auth/       # JWT authentication
│       │   ├── ai/         # AI orchestration
│       │   │   ├── agents/      # 7 specialized agents
│       │   │   ├── prompts/     # Modular prompt templates
│       │   │   ├── orchestrator/ # Agent coordination
│       │   │   ├── schemas/     # Zod validation
│       │   │   └── validators/  # Response validators
│       │   ├── proposal/   # Proposal CRUD
│       │   └── comparison/ # Proposal comparison
│       └── utils/    # Text extraction
│
└── frontend/         # React + Vite + TypeScript
    └── src/
        ├── components/  # UI components, layout
        ├── pages/       # All app pages
        ├── services/    # API layer (Axios)
        ├── store/       # Zustand state management
        ├── types/       # TypeScript interfaces
        └── utils/       # Helpers & formatters
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, TypeScript |
| Styling | TailwindCSS v4, Framer Motion |
| State | Zustand, TanStack Query |
| Charts | Recharts |
| Upload | React Dropzone |
| Backend | Node.js, Express, TypeScript |
| Database | Firebase Firestore |
| SDK | Firebase Admin SDK |
| AI | Groq API (LLaMA 3.3 70B) |
| Auth | JWT, bcrypt |
| Validation | Zod |

## AI Agents

1. **Extraction Agent** — Extracts structured data from proposal documents
2. **Agriculture Analysis Agent** — Evaluates agriculture sector impact
3. **Financial Analysis Agent** — Analyzes financial viability
4. **Sustainability Agent** — Scores environmental & social sustainability
5. **Risk Assessment Agent** — Identifies and scores risks
6. **Innovation Analysis Agent** — Evaluates technology & innovation
7. **Final Scoring Agent** — Generates weighted overall score

### Scoring Weights
- Innovation: 20%
- Market Potential: 20%
- Agriculture Impact: 20%
- Financial Viability: 15%
- Scalability: 10%
- Sustainability: 10%
- Risk: 5%

## Setup

### Prerequisites
- Node.js 18+
- Firebase Project (Firestore enabled)

### Backend
```bash
cd backend
npm install
# Add your firebase-service-account.json to the backend/ folder
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Environment Variables

**Backend (.env):**
```
FIREBASE_PROJECT_ID=your-project-id
JWT_SECRET=your-secret-key-min-10-chars
GROQ_API_KEY=your-groq-api-key
PORT=3001
```

**Frontend (.env):**
```
VITE_API_URL=http://localhost:3001/api
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login user |
| GET | /api/auth/profile | Get profile |
| POST | /api/proposals/upload | Upload proposal |
| GET | /api/proposals | List proposals |
| GET | /api/proposals/:id | Get proposal detail |
| DELETE | /api/proposals/:id | Delete proposal |
| POST | /api/ai/evaluate | Run AI evaluation |
| POST | /api/ai/compare | Compare proposals |
| GET | /api/ai/dashboard | Dashboard stats |
| GET | /api/comparisons | List comparisons |

## Pages

1. **Landing Page** — Hero, features, workflow, testimonials
2. **Login / Register** — JWT authentication
3. **Dashboard** — Stats, charts, recent proposals, AI insights
4. **Upload** — Drag & drop with multi-file support
5. **Proposals** — List with search & pagination
6. **Proposal Detail** — Scores, charts, SWOT, agent results
7. **Compare** — Side-by-side with radar & bar charts
8. **Analytics** — Trends, distribution, categories
9. **Settings** — Profile, notifications, API config

## Future Roadmap
- OCR support for scanned documents
- RAG integration with vector database
- Multi-language proposal support
- Investor recommendation AI
- AI chat with proposal
- Voice-based review
- Team collaboration
- BullMQ + Redis job queue
