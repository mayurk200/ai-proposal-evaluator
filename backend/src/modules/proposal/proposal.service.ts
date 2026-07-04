import { v4 as uuidv4 } from 'uuid';
import { collections } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { extractTextFromBuffer } from '../../utils/textExtractor';
import { createStorageProvider } from '../../providers/storage/factory';
import { createLLMProvider } from '../../providers/llm/factory';
import { env } from '../../config/env';
import {
  buildExtractionMetadata,
  buildExtractedFileContent,
  normalizeCompanyName,
  MAX_AI_INPUT_CHARS,
  PROPOSAL_JSON_PROMPT,
} from './extraction.helper';

const storageProvider = createStorageProvider();

/** Model used for the Phase 2 structured-JSON extraction, per provider. */
const EXTRACTION_MODELS: Record<string, string> = {
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3',
};

/** Extraction engine label per mime type (for metadata). */
function extractionEngineFor(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'pdf-parse';
  if (mimeType.includes('wordprocessingml') || mimeType === 'application/msword') return 'mammoth';
  if (mimeType === 'text/plain') return 'utf-8';
  return 'unknown';
}

export class ProposalService {
  /**
   * PHASE 1 — Upload only.
   * Stores the raw file in the configured storage (S3 in production) and
   * creates the proposal record. No extraction happens here; extraction is
   * triggered explicitly by the user in Phase 2 via extract().
   */
  async create(data: {
    title: string;
    fileName: string;
    file: Express.Multer.File;
    userId: string | null;
  }) {
    const id = uuidv4();
    const now = new Date().toISOString();

    // Upload original file to storage (S3 / MinIO / local depending on env)
    const filePath = await storageProvider.upload(data.file);

    const proposal = {
      id,
      title: data.title,
      fileName: data.fileName,

      // Original file location in storage
      filePath,
      fileUrl: storageProvider.getUrl(filePath),
      fileSize: data.file.size,
      fileType: data.file.mimetype,

      userId: data.userId,

      // Pipeline state
      phase: 1,
      status: 'UPLOADED',

      // Flags (resolved in later phases)
      isEvaluated: false,
      isSelected: false,
      companyPreviouslySubmitted: null as boolean | null,
      companyPreviouslySelected: null as boolean | null,

      // Phase 2 outputs (filled by extract())
      companyName: null as string | null,
      companyNameNormalized: null as string | null,
      extractedText: null as string | null,
      extractedFilePath: null as string | null,
      extractedFileUrl: null as string | null,
      jsonFilePath: null as string | null,
      jsonFileUrl: null as string | null,
      proposalJson: null as Record<string, any> | null,

      createdAt: now,
      updatedAt: now,
    };

    await collections.proposals.doc(id).set(proposal);
    return proposal;
  }

  /**
   * PHASE 2 — Extract + AI structuring.
   * Triggered by the user. Downloads the original file from storage, extracts
   * the text (with enrichment metadata), asks the LLM to build a structured
   * proposal JSON, resolves the duplicate-company flags, stores the extracted
   * text file and the JSON file back in storage, and persists everything in
   * the database.
   */
  async extract(id: string, userId: string | null, force = false) {
    const doc = await collections.proposals.doc(id).get();
    if (!doc.exists) {
      throw new AppError('Proposal not found', 404);
    }

    const data = doc.data()!;
    if (data.userId && data.userId !== userId) {
      throw new AppError('Access denied', 403);
    }
    if (data.status === 'EXTRACTING') {
      throw new AppError('Extraction is already in progress for this proposal', 409);
    }
    // Idempotent: return existing result unless force re-extraction requested
    if (data.proposalJson && !force) {
      return { ...data, alreadyExtracted: true };
    }

    await collections.proposals.doc(id).update({
      status: 'EXTRACTING',
      updatedAt: new Date().toISOString(),
    });

    try {
      // 1. Download original file from storage
      const fileBuffer = await storageProvider.download(data.filePath);

      // 2. Extract raw text
      const text = await extractTextFromBuffer(fileBuffer, data.fileType);
      if (!text || text.trim().length < 50) {
        throw new AppError(
          'Could not extract sufficient text from the file. Ensure the document contains readable text.',
          422
        );
      }

      // 3. Enrichment metadata
      const extractionMeta = buildExtractionMetadata(text, extractionEngineFor(data.fileType));

      // 4. Store extracted text file in storage
      const extractedFileContent = buildExtractedFileContent(extractionMeta, id, data.fileName, text);
      const extractedFilePath = await storageProvider.uploadBuffer(
        Buffer.from(extractedFileContent, 'utf-8'),
        `extracted/${id}.txt`,
        'text/plain'
      );
      const extractedFileUrl = storageProvider.getUrl(extractedFilePath);

      // 5. AI model → structured proposal JSON
      const llm = createLLMProvider();
      const model = EXTRACTION_MODELS[env.LLM_PROVIDER] ?? EXTRACTION_MODELS.groq;
      const aiInput = text.slice(0, MAX_AI_INPUT_CHARS);
      const aiResponse = await llm.chat(PROPOSAL_JSON_PROMPT, aiInput, {
        model,
        temperature: 0.2,
        maxTokens: 4000,
      });
      const aiProposal = aiResponse.result ?? {};

      // 6. Duplicate-company flags
      const companyName: string | null = aiProposal.companyName ?? null;
      const companyNameNormalized = normalizeCompanyName(companyName);
      let companyPreviouslySubmitted = false;
      let companyPreviouslySelected = false;

      if (companyNameNormalized) {
        const dupSnap = await collections.proposals
          .where('companyNameNormalized', '==', companyNameNormalized)
          .get();
        const others = dupSnap.docs
          .map((d: any) => d.data())
          .filter((p: any) => p.id !== id);
        companyPreviouslySubmitted = others.length > 0;
        companyPreviouslySelected = others.some(
          (p: any) => p.isSelected === true || p.status === 'SELECTED'
        );
      }

      // 7. Assemble the final proposal JSON document
      const now = new Date().toISOString();
      const proposalJson: Record<string, any> = {
        schemaVersion: '1.0',
        proposalId: id,
        title: data.title,
        generatedAt: now,
        files: {
          original: {
            storageProvider: env.STORAGE_PROVIDER,
            storageKey: data.filePath,
            url: data.fileUrl ?? storageProvider.getUrl(data.filePath),
            fileName: data.fileName,
            fileSize: data.fileSize,
            fileType: data.fileType,
          },
          extractedText: {
            storageProvider: env.STORAGE_PROVIDER,
            storageKey: extractedFilePath,
            url: extractedFileUrl,
            fileType: 'text/plain',
          },
        },
        flags: {
          isEvaluated: false,
          isSelected: false,
          companyPreviouslySubmitted,
          companyPreviouslySelected,
        },
        extraction: extractionMeta,
        proposal: aiProposal,
        ai: {
          provider: env.LLM_PROVIDER,
          model,
          tokens: aiResponse.tokens,
          durationMs: aiResponse.duration,
        },
      };

      // 8. Store the JSON file in storage
      const jsonFilePath = await storageProvider.uploadBuffer(
        Buffer.from(JSON.stringify(proposalJson, null, 2), 'utf-8'),
        `proposal-json/${id}.json`,
        'application/json'
      );
      const jsonFileUrl = storageProvider.getUrl(jsonFilePath);
      proposalJson.files.json = {
        storageProvider: env.STORAGE_PROVIDER,
        storageKey: jsonFilePath,
        url: jsonFileUrl,
        fileType: 'application/json',
      };

      // 9. Persist everything in the database
      const updates = {
        phase: 2,
        status: 'EXTRACTED',
        companyName,
        companyNameNormalized,
        isEvaluated: false,
        companyPreviouslySubmitted,
        companyPreviouslySelected,
        extractedText: text.slice(0, 500_000),
        extractedFilePath,
        extractedFileUrl,
        jsonFilePath,
        jsonFileUrl,
        proposalJson,
        extractionError: null as string | null,
        updatedAt: new Date().toISOString(),
      };
      await collections.proposals.doc(id).update(updates);

      return { ...data, ...updates };
    } catch (error: any) {
      await collections.proposals.doc(id).update({
        status: 'EXTRACTION_FAILED',
        extractionError: error?.message ?? 'Unknown extraction error',
        updatedAt: new Date().toISOString(),
      });
      if (error instanceof AppError) throw error;
      throw new AppError(`Extraction failed: ${error?.message ?? 'unknown error'}`, 500);
    }
  }

  async findAll(userId: string | null, page: number = 1, limit: number = 10) {
    // Get total count
    let countQuery: any = collections.proposals;
    if (userId) {
      countQuery = countQuery.where('userId', '==', userId);
    }
    const countSnap = await countQuery.count().get();
    const total = countSnap.data().count;

    // Get paginated proposals
    const skip = (page - 1) * limit;
    let query: any = collections.proposals;
    if (userId) {
      query = query.where('userId', '==', userId);
    }
    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .offset(skip)
      .limit(limit)
      .get();

    const proposals = await Promise.all(
      snapshot.docs.map(async (doc: any) => {
        const proposal = doc.data();
        // Get evaluation if exists
        const evalSnap = await collections.evaluations
          .where('proposalId', '==', proposal.id)
          .limit(1)
          .get();

        const evaluation = evalSnap.empty ? null : {
          id: evalSnap.docs[0].data().id,
          overallScore: evalSnap.docs[0].data().overallScore,
          recommendation: evalSnap.docs[0].data().recommendation,
          summary: evalSnap.docs[0].data().summary,
        };

        return { ...proposal, evaluation };
      })
    );

    return {
      proposals,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string, userId: string | null) {
    const doc = await collections.proposals.doc(id).get();
    const data = doc.data();

    if (!doc.exists) {
      throw new AppError('Proposal not found', 404);
    }

    // Only allow access if the user owns it, OR if the proposal is currently anonymous
    if (data?.userId && data.userId !== userId) {
      throw new AppError('Access denied', 403);
    }

    const proposal = doc.data()!;

    // Get evaluation
    const evalSnap = await collections.evaluations
      .where('proposalId', '==', id)
      .limit(1)
      .get();
    const evaluation = evalSnap.empty ? null : evalSnap.docs[0].data();

    // Get AI logs
    const logsSnap = await collections.aiLogs
      .where('proposalId', '==', id)
      .orderBy('createdAt', 'asc')
      .get();
    const aiLogs = logsSnap.docs.map((d: any) => d.data());

    return { ...proposal, evaluation, aiLogs };
  }

  async claimProposal(id: string, userId: string) {
    const doc = await collections.proposals.doc(id).get();
    const data = doc.data();

    if (!doc.exists) {
      throw new AppError('Proposal not found', 404);
    }

    if (data?.userId) {
      if (data.userId === userId) return { message: 'Already claimed by you' };
      throw new AppError('Proposal is already claimed by another user', 403);
    }

    await collections.proposals.doc(id).update({ userId });
    return { message: 'Proposal successfully saved to your dashboard' };
  }

  async delete(id: string, userId: string | null) {
    const doc = await collections.proposals.doc(id).get();

    if (!doc.exists) {
      throw new AppError('Proposal not found', 404);
    }

    const data = doc.data();
    // Allow deletion if: no owner (anonymous), or userId matches the owner
    if (data?.userId && userId && data.userId !== userId) {
      throw new AppError('Access denied', 403);
    }

    // Delete related evaluations
    const evalSnap = await collections.evaluations.where('proposalId', '==', id).get();
    const batch1 = collections.evaluations.firestore.batch();
    evalSnap.docs.forEach((d: any) => batch1.delete(d.ref));
    await batch1.commit();

    // Delete related AI logs
    const logsSnap = await collections.aiLogs.where('proposalId', '==', id).get();
    const batch2 = collections.aiLogs.firestore.batch();
    logsSnap.docs.forEach((d: any) => batch2.delete(d.ref));
    await batch2.commit();

    // Delete proposal
    await collections.proposals.doc(id).delete();

    return { message: 'Proposal deleted successfully' };
  }

  async reject(id: string, userId: string | null) {
    const doc = await collections.proposals.doc(id).get();
    
    if (!doc.exists) {
      throw new AppError('Proposal not found', 404);
    }

    const data = doc.data();
    if (data?.userId && data.userId !== userId) {
      throw new AppError('Access denied', 403);
    }

    await collections.proposals.doc(id).update({ status: 'REJECTED' });
    return { message: 'Proposal rejected successfully' };
  }
}

export const proposalService = new ProposalService();
