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
    super({ name: 'ExtractionAgent', temperature: 0.1, maxTokens: 1500, maxInputChars: 10000 });
  }

  async analyze(text: string) {
    return this.execute(EXTRACTION_PROMPT, text);
  }
}

export class AgricultureAnalysisAgent extends BaseAgent {
  constructor() {
    super({ name: 'AgricultureAnalysisAgent', temperature: 0.3, maxTokens: 1200, maxInputChars: 9000 });
  }

  async analyze(data: string) {
    return this.execute(AGRICULTURE_ANALYSIS_PROMPT, data);
  }
}

export class FinancialAnalysisAgent extends BaseAgent {
  constructor() {
    super({ name: 'FinancialAnalysisAgent', temperature: 0.2, maxTokens: 1200, maxInputChars: 9000 });
  }

  async analyze(data: string) {
    return this.execute(FINANCIAL_ANALYSIS_PROMPT, data);
  }
}

export class SustainabilityAgent extends BaseAgent {
  constructor() {
    super({ name: 'SustainabilityAgent', temperature: 0.3, maxTokens: 1200, maxInputChars: 9000 });
  }

  async analyze(data: string) {
    return this.execute(SUSTAINABILITY_PROMPT, data);
  }
}

export class RiskAssessmentAgent extends BaseAgent {
  constructor() {
    super({ name: 'RiskAssessmentAgent', temperature: 0.2, maxTokens: 1200, maxInputChars: 9000 });
  }

  async analyze(data: string) {
    return this.execute(RISK_ASSESSMENT_PROMPT, data);
  }
}

export class InnovationAnalysisAgent extends BaseAgent {
  constructor() {
    super({ name: 'InnovationAnalysisAgent', temperature: 0.3, maxTokens: 1200, maxInputChars: 9000 });
  }

  async analyze(data: string) {
    return this.execute(INNOVATION_ANALYSIS_PROMPT, data);
  }
}

export class FinalScoringAgent extends BaseAgent {
  constructor() {
    super({ name: 'FinalScoringAgent', temperature: 0.2, maxTokens: 1500, maxInputChars: 10000 });
  }

  async analyze(data: string) {
    return this.execute(FINAL_SCORING_PROMPT, data);
  }
}
