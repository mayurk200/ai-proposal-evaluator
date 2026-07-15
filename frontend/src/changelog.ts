/**
 * Version history shown on the About page ("Version history" section).
 * Newest entry first. Keep `version` in sync with package.json — add an
 * entry here on every version bump.
 */
export interface VersionEntry {
  version: string;
  date: string; // YYYY-MM-DD
  summary: string;
  details: string[];
}

export const CHANGELOG: VersionEntry[] = [
  {
    version: '0.3.0',
    date: '2026-07-12',
    summary:
      'Complete authentication overhaul: hardened login with account lockout, secure session management with automatic token refresh, and a full set of account security endpoints backed by PostgreSQL.',
    details: [
      'User accounts, sessions and an authentication audit trail now live in normalized PostgreSQL tables (existing accounts are migrated automatically).',
      'Passwords are hashed with Argon2id; accounts created earlier are upgraded transparently on their next sign-in.',
      'Sign-in is protected against brute force: 5 failed attempts temporarily lock the account, and credential endpoints are rate-limited per IP.',
      'Sessions use a short-lived (15 min) access token plus a 30-day rotating refresh token stored in a secure HttpOnly cookie — the app silently refreshes expired sessions instead of logging you out.',
      'New account endpoints: change password, forgot/reset password, view active sessions, revoke a session, and sign out of all devices.',
      'Stronger password policy for new passwords: minimum 12 characters with upper/lower case, a number and a symbol.',
      'Every authentication event (sign-ins, failures, lockouts, password changes, session revocations) is recorded in an audit log with IP and browser details.',
    ],
  },
  {
    version: '0.2.2',
    date: '2026-07-11',
    summary: 'Rankings leaderboard rows now show the proposal ID with the name beside it, and the ID copy interaction is simpler.',
    details: [
      'Leaderboard rows lead with the short proposal ID followed by the proposal name, matching the list view.',
      'The list cards show the name next to the ID as well.',
      'Simpler ID interaction: click the ID itself to copy the full UUID (the separate copy button is gone); hovering shows the full ID.',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-07-11',
    summary: 'Proposal cards in the Proposals list are now labeled by their proposal ID instead of the document name.',
    details: [
      'Each card’s main label is the short proposal ID (first 8 characters) with a copy button for the full UUID.',
      'The filename remains visible in the small info row under the ID; search still matches titles and filenames.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-07-11',
    summary:
      'Added this version history section to the About page and corrected the AI agents documentation to match the real AIAIC evaluation pipeline.',
    details: [
      'New "Version history" section on the About page: every release with a short summary and an expandable full change list.',
      'The "AI agents" section now lists the actual evaluation pipeline (Extraction, the 7 AIAIC parameter agents, Debate, Scoring) instead of an outdated agent list.',
      'The overview now describes scoring against the 7 AIAIC parameters (Problem Relevance, Solution Readiness, Pilot Design, Farmer Adoption, Scale-up Potential, Team Capacity, Compliance).',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-07-11',
    summary:
      'Internal cleanup: removed the legacy Node.js evaluation pipeline and unused code so all processing and evaluation runs through the Python AI service.',
    details: [
      'Removed the legacy backend AI pipeline (/api/ai/*) and its LLM providers — evaluation now always uses the Python multi-agent service.',
      'Removed unused storage providers (S3, Cloudinary); storage is MinIO or local disk.',
      'Removed the duplicate Evaluate button on the proposal detail page — evaluations are started from the Proposals page.',
      'Dropped 19 unused dependencies across frontend, backend and the Python service (~4,900 lines of dead code deleted).',
      'Documentation (README, architecture, API reference, testing guide) updated to describe the current upload → process → evaluate flow.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-11',
    summary:
      'First beta release of the AIAIC proposal evaluation portal with the full upload → categorize → evaluate workflow.',
    details: [
      'Upload one or many proposal documents (PDF, Word, PowerPoint, text, images) to object storage.',
      'Processing pipeline: text extraction with OCR for scanned pages, duplicate detection by storage key and SHA-256 hash, AI categorization into the 25-category agri taxonomy with a 0–100 triage score.',
      'Full multi-agent evaluation against the 7 AIAIC parameters, with debate-based conflict resolution and SWOT analysis.',
      'Proposals page with search, category filter, rankings leaderboard and category standings.',
      'Report comparison of 2–5 evaluated proposals with radar and bar charts.',
      'JWT authentication (register, login, claim), settings page driven by the backend settings registry.',
      'Landing page redesigned as the AIAIC government portal, with Beta badge and app version display.',
    ],
  },
];
