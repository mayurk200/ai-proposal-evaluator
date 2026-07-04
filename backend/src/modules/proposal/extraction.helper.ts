/**
 * Phase 2 helpers: extraction enrichment metadata, company-name normalization,
 * and the AI prompt that turns raw extracted text into a structured proposal JSON.
 */

export interface ExtractionMetadata {
  extractedAt: string;
  engine: string;
  charCount: number;
  wordCount: number;
  lineCount: number;
  estimatedPages: number;
  detectedEmails: string[];
  detectedPhones: string[];
  detectedUrls: string[];
  detectedSections: string[];
  textPreview: string;
}

/** Build enrichment metadata about the extracted text. */
export function buildExtractionMetadata(text: string, engine: string): ExtractionMetadata {
  const lines = text.split(/\r?\n/);
  const words = text.split(/\s+/).filter(Boolean);

  const emails = unique(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g));
  const urls = unique(text.match(/https?:\/\/[^\s)>\]]+/g));
  const phones = unique(text.match(/(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3,5}\)?[-.\s]?)\d{3}[-.\s]?\d{3,4}/g))
    .filter((p) => p.replace(/\D/g, '').length >= 10)
    .slice(0, 10);

  // Heuristic section detection: short lines that look like headings
  const sections = lines
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 2 &&
        l.length < 80 &&
        (/^(\d+[\.\)]\s+|[IVX]+\.\s+)/.test(l) || (/^[A-Z][A-Za-z\s&\-:]+$/.test(l) && l === l.replace(/[a-z]{30,}/, ''))) &&
        /^[A-Z0-9]/.test(l) &&
        !l.endsWith('.')
    )
    .slice(0, 25);

  return {
    extractedAt: new Date().toISOString(),
    engine,
    charCount: text.length,
    wordCount: words.length,
    lineCount: lines.length,
    estimatedPages: Math.max(1, Math.round(words.length / 400)),
    detectedEmails: emails.slice(0, 10),
    detectedPhones: phones,
    detectedUrls: urls.slice(0, 15),
    detectedSections: unique(sections),
    textPreview: text.trim().slice(0, 500),
  };
}

/** Normalize a company name for duplicate-submission matching. */
export function normalizeCompanyName(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string') return null;
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(private|pvt|limited|ltd|llp|llc|inc|incorporated|corp|corporation|co|company|technologies|technology|tech|agro|agri|farms?|solutions?|ventures?|labs?|startup)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || name.toLowerCase().trim() || null;
}

/** Build the pretty text file stored alongside the raw extraction. */
export function buildExtractedFileContent(
  meta: ExtractionMetadata,
  proposalId: string,
  fileName: string,
  text: string
): string {
  return [
    '='.repeat(70),
    'AGRIEVAL — EXTRACTED PROPOSAL TEXT',
    '='.repeat(70),
    `Proposal ID   : ${proposalId}`,
    `Source file   : ${fileName}`,
    `Extracted at  : ${meta.extractedAt}`,
    `Engine        : ${meta.engine}`,
    `Words / Chars : ${meta.wordCount} / ${meta.charCount}`,
    `Est. pages    : ${meta.estimatedPages}`,
    '='.repeat(70),
    '',
    text,
  ].join('\n');
}

/** Max characters of extracted text sent to the LLM. */
export const MAX_AI_INPUT_CHARS = 24000;

/** Prompt instructing the LLM to produce the structured proposal JSON. */
export const PROPOSAL_JSON_PROMPT = `You are an expert proposal analyst for an agriculture startup evaluation platform.
Analyze the proposal text below and return ONLY a valid JSON object with exactly this structure (use null for anything not found, never invent facts):

{
  "companyName": "official company/startup name",
  "companyType": "startup | SME | NGO | research institute | individual | other",
  "contact": { "email": null, "phone": null, "website": null, "address": null },
  "proposalTitle": "title of the proposal",
  "executiveSummary": "3-5 sentence summary of the entire proposal",
  "sector": "primary sector, e.g. agriculture",
  "subSector": "e.g. precision farming, irrigation, agri-fintech",
  "problemStatement": "the problem being solved",
  "proposedSolution": "the proposed solution",
  "technologiesUsed": ["list of technologies mentioned"],
  "innovationHighlights": ["what is novel or differentiating"],
  "targetBeneficiaries": "who benefits, e.g. smallholder farmers",
  "marketSize": "market size / opportunity if stated",
  "businessModel": "how the venture makes money",
  "financials": {
    "totalBudget": null,
    "fundingRequested": null,
    "currency": null,
    "revenueProjection": null,
    "breakEvenTimeline": null
  },
  "timeline": { "durationMonths": null, "milestones": ["key milestones"] },
  "team": { "size": null, "keyMembers": [{ "name": null, "role": null, "expertise": null }] },
  "risks": ["key risks identified in or implied by the proposal"],
  "sustainabilityImpact": "environmental/social impact if mentioned",
  "keywords": ["5-10 topical keywords"],
  "documentLanguage": "primary language of the document",
  "extractionConfidence": 0.0,
  "missingFields": ["important fields that could not be found in the document"]
}

Rules:
- Respond with pure JSON only. No markdown, no code fences, no commentary.
- "extractionConfidence" is your 0-1 confidence that the extracted fields are accurate.
- Numbers in financials should be plain numbers (no currency symbols); put the currency code in "currency".

PROPOSAL TEXT:
`;

function unique(arr: string[] | null): string[] {
  return [...new Set(arr ?? [])];
}
