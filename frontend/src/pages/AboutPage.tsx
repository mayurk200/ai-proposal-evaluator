import { motion } from 'framer-motion';
import {
  Leaf, Workflow, Fingerprint, Gauge, Trophy, Layers, FileType,
  Bot, Database, Plug, Cpu, Trash2, ShieldCheck, Info, FolderTree,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Badge } from '@/components/ui';

/* ------------------------------------------------------------------ */
/* Static content — every fact below is sourced from the codebase.     */
/* ------------------------------------------------------------------ */

const pipelineSteps = [
  {
    title: 'Upload',
    detail:
      'You drop one or more files (up to 20 per request) on the Upload page. The Node backend stores each file in the MinIO object bucket and returns its storage key and a browser-openable URL. Nothing is analyzed yet.',
  },
  {
    title: 'Send for processing',
    detail:
      'From the file list you pick files to process. The backend downloads each object from storage and forwards it to the Python AI service. If the Python service is down you get a clear "service unavailable" message — nothing is silently skipped.',
  },
  {
    title: 'Duplicate check',
    detail:
      'Before creating anything, the Python service checks whether this exact file was already processed — first by its storage key, then by a SHA-256 hash of the file bytes. If a match exists, the existing proposal is returned instead of creating a duplicate.',
  },
  {
    title: 'Proposal created',
    detail:
      'A new proposal row is created in PostgreSQL with a freshly generated ID and status "categorizing". The API responds immediately; the heavy work continues in the background.',
  },
  {
    title: 'Text extraction & OCR',
    detail:
      'The document processor extracts text page by page (PyMuPDF for PDF, python-docx for Word, python-pptx for PowerPoint). Scanned pages and images go through OCR — Tesseract first, EasyOCR as fallback. Tables, images and section headings are detected and counted.',
  },
  {
    title: 'AI categorization',
    detail:
      'The extracted text goes to the categorization agent (a single Groq LLM call, temperature 0.2). It returns one JSON object: a title, a summary, up to 8 agriculture categories, review flags, a 0–100 triage score and a 0.0–1.0 confidence.',
  },
  {
    title: 'Persist & display',
    detail:
      'The result is validated (the score is clamped to 0–100), saved to the proposals table, and the row moves to status "categorized" (or "failed" with an error code). The Proposals page polls the list and shows the finished card.',
  },
];

const idSteps = [
  {
    step: '1',
    title: 'Generated as a UUID v4',
    detail:
      'When a file is sent for processing, the Python service creates the proposal ID with uuid.uuid4() — a random 36-character identifier like "3f2b8c1d-9a4e-4b7f-8c2d-1e5a6f7b8c9d". It is not derived from the filename, the upload order, or a database counter.',
  },
  {
    step: '2',
    title: 'Unless the file is a duplicate',
    detail:
      'Two checks run first: (a) has this storage key already been processed? (b) does any proposal have the same SHA-256 file hash? If either matches, no new ID is created — you get the existing proposal back, marked "deduplicated". Re-uploading the same document always resolves to the same proposal.',
  },
  {
    step: '3',
    title: 'Used as the primary key',
    detail:
      'The UUID is the primary key of the proposals table in PostgreSQL (a 36-character string column). Every status update, categorization result and timestamp is written against it.',
  },
  {
    step: '4',
    title: 'Organizes the stored artifacts',
    detail:
      'All files derived from a proposal live under its ID in object storage: originals/{id}/ holds the source file, extracted/{id}/ holds the extracted text, and json/{id}.json is the processing manifest.',
  },
  {
    step: '5',
    title: 'Drives the API and the UI',
    detail:
      'The same ID appears everywhere: GET /api/uploads/processed/:id fetches the full record for the "More info" modal, DELETE /api/uploads/processed/:id removes it, and the detail route /proposals/:id uses it in the page URL.',
  },
];

const statuses = [
  { value: 'categorizing', variant: 'info' as const, detail: 'Row just created; work queued in the background.' },
  { value: 'extracting', variant: 'warning' as const, detail: 'Text extraction / OCR in progress.' },
  { value: 'categorized', variant: 'success' as const, detail: 'Done — score, categories and summary are available.' },
  { value: 'failed', variant: 'danger' as const, detail: 'Something broke; the row keeps an error code and message.' },
];

const failureCodes = [
  'upload_failed', 'download_failed', 'extraction_failed', 'ocr_failed', 'ai_failed',
  'json_validation_failed', 'database_failed', 'embedding_failed', 'storage_failed',
];

const taxonomy = [
  'precision-agriculture', 'iot-and-sensors', 'remote-sensing-and-gis', 'ai-and-data-analytics',
  'farm-automation-and-robotics', 'drones-and-aerial-imaging', 'soil-health-and-nutrition',
  'crop-health-and-protection', 'irrigation-and-water-management', 'weather-and-climate-resilience',
  'livestock-and-dairy', 'aquaculture-and-fisheries', 'horticulture-and-plantation', 'seeds-and-genetics',
  'post-harvest-and-cold-chain', 'supply-chain-and-logistics', 'market-linkage-and-e-commerce',
  'agri-fintech-and-credit', 'agri-insurance', 'farmer-advisory-and-extension',
  'traceability-and-food-safety', 'sustainability-and-regenerative-ag', 'carbon-and-agroforestry',
  'biotech-and-inputs', 'farm-management-software',
];

const formats = [
  { format: 'PDF', ext: '.pdf', how: 'PyMuPDF text extraction + OCR for scanned pages' },
  { format: 'Word', ext: '.docx, .doc', how: 'python-docx with heading & table detection' },
  { format: 'PowerPoint', ext: '.pptx, .ppt', how: 'python-pptx, slide-by-slide extraction' },
  { format: 'Plain text', ext: '.txt', how: 'Direct read' },
  { format: 'Images', ext: '.png, .jpg, .jpeg, .tiff, .bmp', how: 'Full OCR via Tesseract / EasyOCR' },
];

const agents = [
  { name: 'Extraction', role: 'Structured data: team, funding, timeline, market' },
  { name: 'Technical', role: 'Architecture, tech stack, scalability' },
  { name: 'Financial', role: 'Revenue model, unit economics, ROI' },
  { name: 'Risk', role: '9-dimensional risk assessment' },
  { name: 'Innovation', role: 'Novelty, IP potential, disruption score' },
  { name: 'Feasibility', role: 'Team capability, timeline realism, market fit' },
  { name: 'Compliance', role: 'Governance, data privacy, regulatory readiness' },
  { name: 'Sustainability', role: 'Environmental, social, economic sustainability' },
  { name: 'Final Scoring', role: 'Cross-agent synthesis, weighted score, SWOT' },
];

const backendEndpoints = [
  { method: 'POST', path: '/api/uploads', desc: 'Store one or more files (multipart field "files") in the bucket' },
  { method: 'GET', path: '/api/uploads', desc: 'List stored files not yet sent for processing' },
  { method: 'POST', path: '/api/uploads/process', desc: 'Send stored files for extraction + categorization' },
  { method: 'GET', path: '/api/uploads/processed', desc: 'List processed proposals (?category, ?status, ?page, ?limit)' },
  { method: 'GET', path: '/api/uploads/processed/:id', desc: 'Full record for one proposal ("More info")' },
  { method: 'DELETE', path: '/api/uploads/processed/:id', desc: 'Delete proposal: DB row + all stored files' },
  { method: 'GET', path: '/api/uploads/categories', desc: 'Distinct agri categories with counts' },
  { method: 'POST', path: '/api/auth/register', desc: 'Register a user (JWT + bcrypt)' },
  { method: 'POST', path: '/api/auth/login', desc: 'Log in and receive a JWT' },
];

const pythonEndpoints = [
  { method: 'GET', path: '/api/v1/health', desc: 'Service health check' },
  { method: 'GET', path: '/api/v1/supported-formats', desc: 'Supported file formats' },
  { method: 'POST', path: '/api/v1/categorize', desc: 'Create proposal + run extraction & categorization (async)' },
  { method: 'POST', path: '/api/v1/process-document', desc: 'Extract & chunk a document' },
  { method: 'POST', path: '/api/v1/evaluate', desc: 'Full multi-agent evaluation pipeline' },
  { method: 'GET', path: '/api/v1/proposals', desc: 'List proposal rows' },
  { method: 'GET', path: '/api/v1/proposals/:id', desc: 'One proposal row' },
  { method: 'DELETE', path: '/api/v1/proposals/:id', desc: 'Delete row + extracted/manifest artifacts' },
];

const stack = [
  { layer: 'Frontend', tech: 'React 19, Vite, TypeScript, TailwindCSS v4, Framer Motion' },
  { layer: 'State & data', tech: 'Zustand, TanStack Query, Recharts' },
  { layer: 'Backend', tech: 'Node.js, Express, TypeScript' },
  { layer: 'AI service', tech: 'Python 3.11, FastAPI, Pydantic' },
  { layer: 'LLM', tech: 'Groq API — LLaMA 3.3 70B Versatile' },
  { layer: 'OCR', tech: 'Tesseract with EasyOCR fallback' },
  { layer: 'Document parsing', tech: 'PyMuPDF, python-docx, python-pptx' },
  { layer: 'Storage', tech: 'PostgreSQL (proposal records) + MinIO (files)' },
  { layer: 'Auth', tech: 'JWT + bcrypt' },
  { layer: 'Testing', tech: 'pytest (Python), Vitest (Node.js)' },
];

const recordGroups = [
  {
    group: 'File identity',
    fields: 'id (UUID), filename, document_format, file_content_type, file_size_bytes, file_hash (SHA-256)',
  },
  {
    group: 'Storage links',
    fields: 'source_key/url (upload bucket), original_key/url, extracted_key/url, manifest_key/url',
  },
  {
    group: 'Extraction stats',
    fields: 'extracted_text, char_count, total_pages, total_words, total_images, total_tables, has_scanned_content, detected_sections',
  },
  {
    group: 'Categorization',
    fields: 'categories (JSON array), category_json (full agent output), rank (0–100 score), agri_relevant',
  },
  {
    group: 'Lifecycle',
    fields: 'status, failure_status, error_code, retry_count, timestamps (created / started / completed)',
  },
];

/* ------------------------------------------------------------------ */

function SectionHeader({ icon: Icon, title, subtitle }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <div className="w-9 h-9 rounded-lg bg-accent-light flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-text">{title}</h3>
        {subtitle && <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const variant =
    method === 'GET' ? 'info' : method === 'DELETE' ? 'danger' : 'success';
  return <Badge variant={variant}>{method}</Badge>;
}

export default function AboutPage() {
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6 pb-24">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center">
              <Leaf className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text">About AgriEval</h1>
              <p className="text-sm text-text-muted mt-0.5">
                How the platform works, end to end — nothing left out.
              </p>
            </div>
          </div>
        </motion.div>

        {/* What is this */}
        <Card hover={false}>
          <SectionHeader icon={Info} title="What is AgriEval?" />
          <p className="text-sm text-text-secondary leading-relaxed">
            AgriEval is an AI-powered platform for evaluating agriculture startup proposals.
            You upload a proposal document (PDF, Word, PowerPoint, plain text or even a photo
            of a printed page) and the system extracts the text — running OCR when the document
            is scanned — then uses an LLM (Groq, LLaMA 3.3 70B) to categorize it into
            agriculture domains, summarize it, and give it a quick 0–100 triage score. A deeper
            9-agent evaluation pipeline can score a proposal across innovation, financials,
            risk, sustainability and more, and produce a SWOT analysis.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="success">Max file size: 50 MB</Badge>
            <Badge variant="info">Up to 20 files per upload</Badge>
            <Badge variant="default">11 file formats</Badge>
            <Badge variant="default">25-category agri taxonomy</Badge>
          </div>
        </Card>

        {/* Pipeline */}
        <Card hover={false}>
          <SectionHeader
            icon={Workflow}
            title="The processing pipeline"
            subtitle="What happens between dropping a file and seeing a scored card."
          />
          <ol className="space-y-4">
            {pipelineSteps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div>
                  <p className="text-sm font-semibold text-text">{s.title}</p>
                  <p className="text-sm text-text-secondary leading-relaxed mt-0.5">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        {/* Proposal ID */}
        <Card hover={false}>
          <SectionHeader
            icon={Fingerprint}
            title="How a proposal gets its ID"
            subtitle="The ID you see in URLs and the “More info” modal — where it comes from."
          />
          <div className="space-y-4">
            {idSteps.map((s) => (
              <div key={s.step} className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {s.step}
                </div>
                <div>
                  <p className="text-sm font-semibold text-text">{s.title}</p>
                  <p className="text-sm text-text-secondary leading-relaxed mt-0.5">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg bg-background border border-border p-4">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
              Example ID format (UUID v4)
            </p>
            <code className="text-sm text-primary font-mono break-all">
              3f2b8c1d-9a4e-4b7f-8c2d-1e5a6f7b8c9d
            </code>
            <p className="text-xs text-text-muted mt-2">
              8-4-4-4-12 hexadecimal characters, random — collisions are practically impossible.
            </p>
          </div>
        </Card>

        {/* Score */}
        <Card hover={false}>
          <SectionHeader
            icon={Gauge}
            title="The 0–100 score"
            subtitle="A quick triage signal — not the full evaluation."
          />
          <div className="space-y-3 text-sm text-text-secondary leading-relaxed">
            <p>
              Every proposal that finishes processing gets a score from 0 to 100, assigned by the
              categorization agent in a single LLM call. It reflects how complete and promising the
              proposal looks at a glance (data present, clarity, ambition). It is deliberately rough —
              a first-pass filter, not a formal evaluation result.
            </p>
            <p>
              The service clamps whatever the model returns to the 0–100 range and stores it on the
              proposal record. Failed proposals keep score 0 and never appear in rankings. The score
              is assigned once, when categorization completes — to re-score a document, delete the
              proposal and upload it again.
            </p>
            <p>
              Next to the score the agent reports a <span className="font-medium text-text">confidence</span>{' '}
              (0–100%). Low confidence usually means short or ambiguous extracted text — treat those
              scores with skepticism. The agent may also set a{' '}
              <span className="font-medium text-text">needs review</span> flag, shown as a badge on the card.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
            <div className="rounded-lg border border-border p-3 flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-success shrink-0" />
              <div>
                <p className="text-sm font-semibold text-text">80–100</p>
                <p className="text-xs text-text-muted">Green — strong at a glance</p>
              </div>
            </div>
            <div className="rounded-lg border border-border p-3 flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-warning shrink-0" />
              <div>
                <p className="text-sm font-semibold text-text">60–79</p>
                <p className="text-xs text-text-muted">Amber — promising, gaps remain</p>
              </div>
            </div>
            <div className="rounded-lg border border-border p-3 flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-danger shrink-0" />
              <div>
                <p className="text-sm font-semibold text-text">0–59</p>
                <p className="text-xs text-text-muted">Red — incomplete or weak</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Rankings */}
        <Card hover={false}>
          <SectionHeader
            icon={Trophy}
            title="How the Rankings view works"
            subtitle="The leaderboard and category standings on the Proposals page."
          />
          <div className="space-y-3 text-sm text-text-secondary leading-relaxed">
            <p>
              Rankings always work from the <span className="font-medium text-text">full proposal set</span>,
              not the currently filtered list, so every category is compared against the total number of files.
            </p>
            <p>
              <span className="font-medium text-text">Category standings</span> rank each category by how many
              of the total files fall into it (e.g. “3 of 12 files”, with a share bar). A proposal with multiple
              categories counts once in each. Ties are broken by the category’s average score, then alphabetically.
              Positions 1–3 get gold, silver and bronze tiles, and clicking a category filters the leaderboard
              below to that category.
            </p>
            <p>
              <span className="font-medium text-text">The proposal leaderboard</span> includes only proposals with
              status “categorized” and score above 0 — processing and failed rows are excluded. It orders by score,
              highest first; ties are broken by upload time, newest first, so fresh submissions surface. Every entry
              shows “#position of N”: overall positions when no category is selected, within-category positions when
              one is. The search box narrows the leaderboard and positions are recomputed over the visible set.
            </p>
          </div>
        </Card>

        {/* Statuses */}
        <Card hover={false}>
          <SectionHeader
            icon={ShieldCheck}
            title="Processing statuses"
            subtitle="Each proposal moves through these states."
          />
          <div className="space-y-3">
            {statuses.map((s) => (
              <div key={s.value} className="flex items-center gap-3">
                <div className="w-28 shrink-0">
                  <Badge variant={s.variant}>{s.value}</Badge>
                </div>
                <p className="text-sm text-text-secondary">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-text-secondary mt-5 mb-2">
            When something fails, the record keeps a specific failure code so the cause is never a mystery:
          </p>
          <div className="flex flex-wrap gap-2">
            {failureCodes.map((c) => (
              <code key={c} className="text-xs font-mono px-2 py-1 rounded bg-background border border-border text-text-secondary">
                {c}
              </code>
            ))}
          </div>
        </Card>

        {/* Taxonomy */}
        <Card hover={false}>
          <SectionHeader
            icon={FolderTree}
            title="The agriculture category taxonomy"
            subtitle="The categorization agent prefers these 25 curated categories."
          />
          <div className="flex flex-wrap gap-2">
            {taxonomy.map((t) => (
              <Badge key={t} variant="default">{t}</Badge>
            ))}
          </div>
          <div className="space-y-2 text-sm text-text-secondary leading-relaxed mt-5">
            <p>
              A proposal can belong to several categories (up to 8). If nothing in the list fits,
              the agent may invent a new one — but it must still be agriculture-related and written
              as a lowercase kebab-case slug (e.g. “vertical-farming”).
            </p>
            <p>
              If a document is clearly not about agriculture, it gets no categories, is marked as
              not agri-relevant, and receives an “out of scope” flag.
            </p>
          </div>
        </Card>

        {/* Formats */}
        <Card hover={false}>
          <SectionHeader
            icon={FileType}
            title="Supported file formats"
            subtitle="11 formats, up to 50 MB per file."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border">
                  <th className="py-2 pr-4 font-medium">Format</th>
                  <th className="py-2 pr-4 font-medium">Extensions</th>
                  <th className="py-2 font-medium">How it is processed</th>
                </tr>
              </thead>
              <tbody>
                {formats.map((f) => (
                  <tr key={f.format} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-text">{f.format}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-text-secondary">{f.ext}</td>
                    <td className="py-2.5 text-text-secondary">{f.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Agents */}
        <Card hover={false}>
          <SectionHeader
            icon={Bot}
            title="The 9 AI agents (full evaluation)"
            subtitle="Run when a full evaluation is explicitly requested — separate from the triage score."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {agents.map((a, i) => (
              <div key={a.name} className="rounded-lg border border-border p-3">
                <p className="text-xs text-text-muted mb-1">Agent {i + 1}</p>
                <p className="text-sm font-semibold text-text">{a.name}</p>
                <p className="text-xs text-text-secondary mt-1 leading-relaxed">{a.role}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-text-secondary leading-relaxed mt-5">
            The triage score and the evaluation score are different numbers stored in different
            places: the triage score comes from the single categorization call and shows on the
            Proposals page, while the evaluation overall score comes from the full pipeline and
            shows on the Dashboard, Analytics and Compare pages.
          </p>
        </Card>

        {/* Data storage */}
        <Card hover={false}>
          <SectionHeader
            icon={Database}
            title="Where your data lives"
            subtitle="PostgreSQL for records, MinIO object storage for files."
          />
          <div className="space-y-3">
            {recordGroups.map((g) => (
              <div key={g.group} className="rounded-lg border border-border p-3">
                <p className="text-sm font-semibold text-text">{g.group}</p>
                <p className="text-xs font-mono text-text-secondary mt-1 leading-relaxed">{g.fields}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-text-secondary leading-relaxed mt-5">
            Files are stored in three places in the bucket, all keyed by the proposal ID:
            the original upload, the extracted plain text, and a JSON manifest of the processing run.
          </p>
        </Card>

        {/* Deletion */}
        <Card hover={false}>
          <SectionHeader
            icon={Trash2}
            title="Deleting & re-scoring"
          />
          <div className="space-y-2 text-sm text-text-secondary leading-relaxed">
            <p>
              Deleting a proposal removes everything: the Python service deletes the database row and
              the extracted/manifest artifacts, then reports back the original storage key so the
              backend can remove the source file from the upload bucket too.
            </p>
            <p>
              Because scores are assigned only once, deletion is also how you re-score: delete the
              proposal, upload the document again, and it goes through the full pipeline fresh
              (the duplicate check no longer finds it, so a new ID and score are produced).
            </p>
          </div>
        </Card>

        {/* API */}
        <Card hover={false}>
          <SectionHeader
            icon={Plug}
            title="API reference"
            subtitle="Backend (port 3001) proxies to the Python AI service (port 8000); frontend dev server runs on 5173."
          />
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Node backend</p>
          <div className="space-y-2 mb-6">
            {backendEndpoints.map((e) => (
              <div key={e.method + e.path} className="flex flex-wrap items-center gap-2">
                <MethodBadge method={e.method} />
                <code className="text-xs font-mono text-text">{e.path}</code>
                <span className="text-xs text-text-muted">— {e.desc}</span>
              </div>
            ))}
          </div>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Python AI service</p>
          <div className="space-y-2">
            {pythonEndpoints.map((e) => (
              <div key={e.method + e.path} className="flex flex-wrap items-center gap-2">
                <MethodBadge method={e.method} />
                <code className="text-xs font-mono text-text">{e.path}</code>
                <span className="text-xs text-text-muted">— {e.desc}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Tech stack */}
        <Card hover={false}>
          <SectionHeader icon={Cpu} title="Tech stack" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {stack.map((s) => (
                  <tr key={s.layer} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-text whitespace-nowrap">{s.layer}</td>
                    <td className="py-2.5 text-text-secondary">{s.tech}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Architecture footnote */}
        <Card hover={false}>
          <SectionHeader icon={Layers} title="Three services, one flow" />
          <div className="overflow-x-auto">
            <pre className="text-xs font-mono text-text-secondary leading-relaxed">
{`React frontend (5173)
      │  REST (/api)
      ▼
Node.js backend (3001) ──── stores files ───► MinIO bucket
      │  proxy (/api/v1)
      ▼
Python AI service (8000) ── extraction • OCR • LLM agents
      │
      ▼
PostgreSQL ── proposal records, scores, categorization output`}
            </pre>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
