import {
  ExtractionAgent,
  AgricultureAnalysisAgent,
  FinancialAnalysisAgent,
  SustainabilityAgent,
  RiskAssessmentAgent,
  InnovationAnalysisAgent,
  FinalScoringAgent,
} from '../agents';
import { v4 as uuidv4 } from 'uuid';
import { collections } from '../../../config/database';

interface OrchestratorResult {
  extraction: any;
  agriculture: any;
  financial: any;
  sustainability: any;
  risk: any;
  innovation: any;
  finalScore: any;
  agentResults: Record<string, any>;
}

export class AIOrchestrator {
  private extractionAgent = new ExtractionAgent();
  private agricultureAgent = new AgricultureAnalysisAgent();
  private financialAgent = new FinancialAnalysisAgent();
  private sustainabilityAgent = new SustainabilityAgent();
  private riskAgent = new RiskAssessmentAgent();
  private innovationAgent = new InnovationAnalysisAgent();
  private finalScoringAgent = new FinalScoringAgent();

  async evaluate(proposalId: string, text: string): Promise<OrchestratorResult> {
    // Step 1: Extract structured data
    const extraction = await this.runAgent('ExtractionAgent', proposalId, async () => {
      return this.extractionAgent.analyze(text);
    });

    const extractedData = JSON.stringify(extraction.result);

    // Step 2: Run analysis agents sequentially to stay within Groq's TPM rate limit
    const agriculture = await this.runAgent('AgricultureAnalysisAgent', proposalId, () => this.agricultureAgent.analyze(extractedData));
    const financial = await this.runAgent('FinancialAnalysisAgent', proposalId, () => this.financialAgent.analyze(extractedData));
    const sustainability = await this.runAgent('SustainabilityAgent', proposalId, () => this.sustainabilityAgent.analyze(extractedData));
    const risk = await this.runAgent('RiskAssessmentAgent', proposalId, () => this.riskAgent.analyze(extractedData));
    const innovation = await this.runAgent('InnovationAnalysisAgent', proposalId, () => this.innovationAgent.analyze(extractedData));

    // Step 3: Generate final comprehensive score
    const allAnalyses = JSON.stringify({
      extraction: extraction.result,
      agriculture: agriculture.result,
      financial: financial.result,
      sustainability: sustainability.result,
      risk: risk.result,
      innovation: innovation.result,
    });

    const finalScore = await this.runAgent('FinalScoringAgent', proposalId, () =>
      this.finalScoringAgent.analyze(allAnalyses)
    );

    return {
      extraction: extraction.result,
      agriculture: agriculture.result,
      financial: financial.result,
      sustainability: sustainability.result,
      risk: risk.result,
      innovation: innovation.result,
      finalScore: finalScore.result,
      agentResults: {
        extraction: extraction.result,
        agriculture: agriculture.result,
        financial: financial.result,
        sustainability: sustainability.result,
        risk: risk.result,
        innovation: innovation.result,
      },
    };
  }

  private async runAgent(
    agentName: string,
    proposalId: string,
    fn: () => Promise<{ result: any; tokens: number; duration: number }>
  ) {
    try {
      const agentResult = await fn();

      // Log agent execution to Firestore
      await collections.aiLogs.doc(uuidv4()).set({
        id: uuidv4(),
        proposalId,
        agentName,
        prompt: `[${agentName}] evaluation`,
        response: JSON.stringify(agentResult.result),
        tokens: agentResult.tokens,
        duration: agentResult.duration,
        status: 'SUCCESS',
        createdAt: new Date().toISOString(),
      });

      return agentResult;
    } catch (error: any) {
      await collections.aiLogs.doc(uuidv4()).set({
        id: uuidv4(),
        proposalId,
        agentName,
        prompt: `[${agentName}] evaluation`,
        response: error.message,
        tokens: null,
        duration: null,
        status: 'FAILED',
        createdAt: new Date().toISOString(),
      });

      throw error;
    }
  }
}

export const aiOrchestrator = new AIOrchestrator();
