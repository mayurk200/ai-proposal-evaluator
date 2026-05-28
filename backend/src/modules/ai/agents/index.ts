import { BaseAgent } from './baseAgent';
import {
  EXTRACTION_PROMPT,
  AGRICULTURE_ANALYSIS_PROMPT,
  FINANCIAL_ANALYSIS_PROMPT,
  SUSTAINABILITY_PROMPT,
  RISK_ASSESSMENT_PROMPT,
  INNOVATION_ANALYSIS_PROMPT,
  FINAL_SCORING_PROMPT,
} from '../prompts';

export class ExtractionAgent extends BaseAgent {
  constructor() {
    // Reduce maxTokens to 2000 to avoid 413 Payload Too Large (6000 TPM limit)
    super({ name: 'ExtractionAgent', temperature: 0.1, maxTokens: 2000 });
  }

  async analyze(text: string) {
    const MAX_CHUNK_LENGTH = 10000; // ~2500 tokens
    if (text.length <= MAX_CHUNK_LENGTH) {
      return this.execute(EXTRACTION_PROMPT, text);
    }

    console.log(`[ExtractionAgent] Document too large, processing in chunks...`);
    let combinedResult = {};
    let totalTokens = 0;
    let totalDuration = 0;

    for (let i = 0; i < text.length; i += MAX_CHUNK_LENGTH) {
      const chunk = text.substring(i, i + MAX_CHUNK_LENGTH);
      console.log(`[ExtractionAgent] Processing chunk ${Math.floor(i / MAX_CHUNK_LENGTH) + 1}...`);
      
      try {
        const res = await this.execute(EXTRACTION_PROMPT, chunk);
        combinedResult = { ...combinedResult, ...(res.result || {}) };
        totalTokens += res.tokens || 0;
        totalDuration += res.duration || 0;
      } catch (error) {
        console.warn(`[ExtractionAgent] Chunk failed, continuing...`, error);
      }
      
      // Delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    return { result: combinedResult, tokens: totalTokens, duration: totalDuration };
  }
}

export class AgricultureAnalysisAgent extends BaseAgent {
  constructor() {
    super({ name: 'AgricultureAnalysisAgent', temperature: 0.3, maxTokens: 1500 });
  }

  async analyze(data: string) {
    return this.execute(AGRICULTURE_ANALYSIS_PROMPT, data);
  }
}

export class FinancialAnalysisAgent extends BaseAgent {
  constructor() {
    super({ name: 'FinancialAnalysisAgent', temperature: 0.2, maxTokens: 1500 });
  }

  async analyze(data: string) {
    return this.execute(FINANCIAL_ANALYSIS_PROMPT, data);
  }
}

export class SustainabilityAgent extends BaseAgent {
  constructor() {
    super({ name: 'SustainabilityAgent', temperature: 0.3, maxTokens: 1500 });
  }

  async analyze(data: string) {
    return this.execute(SUSTAINABILITY_PROMPT, data);
  }
}

export class RiskAssessmentAgent extends BaseAgent {
  constructor() {
    super({ name: 'RiskAssessmentAgent', temperature: 0.2, maxTokens: 1500 });
  }

  async analyze(data: string) {
    return this.execute(RISK_ASSESSMENT_PROMPT, data);
  }
}

export class InnovationAnalysisAgent extends BaseAgent {
  constructor() {
    super({ name: 'InnovationAnalysisAgent', temperature: 0.3, maxTokens: 1500 });
  }

  async analyze(data: string) {
    return this.execute(INNOVATION_ANALYSIS_PROMPT, data);
  }
}

export class FinalScoringAgent extends BaseAgent {
  constructor() {
    super({ name: 'FinalScoringAgent', temperature: 0.2, maxTokens: 1500 });
  }

  async analyze(data: string) {
    return this.execute(FINAL_SCORING_PROMPT, data);
  }
}
