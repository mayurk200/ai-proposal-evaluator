import { v4 as uuidv4 } from 'uuid';
import { collections } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { extractTextFromFile } from '../../utils/textExtractor';
import { createStorageProvider } from '../../providers/storage/factory';

const storageProvider = createStorageProvider();

export class ProposalService {
  async create(data: {
    title: string;
    fileName: string;
    file: Express.Multer.File;
    userId: string | null;
  }) {
    const id = uuidv4();
    const now = new Date().toISOString();

    // Upload file using storage provider
    const filePath = await storageProvider.upload(data.file);

    const proposal = {
      id,
      title: data.title,
      fileName: data.fileName,
      filePath,
      fileSize: data.file.size,
      fileType: data.file.mimetype,
      userId: data.userId,
      extractedText: null as string | null,
      status: 'UPLOADED',
      createdAt: now,
      updatedAt: now,
    };

    await collections.proposals.doc(id).set(proposal);

    // Extract text in background
    try {
      const text = await extractTextFromFile(filePath, data.file.mimetype);
      await collections.proposals.doc(id).update({ extractedText: text });
      proposal.extractedText = text;
    } catch (error) {
      console.error(`Text extraction failed for proposal ${id}:`, error);
    }

    return proposal;
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
