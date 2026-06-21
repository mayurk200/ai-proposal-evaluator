import { createLLMProvider } from '../../../providers/llm/factory';
import { LLMProvider } from '../../../providers/llm/types';

export interface AgentConfig {
  name: string;
  model: string;
  temperature: number;
  maxTokens: number;
  maxInputChars: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  name: 'BaseAgent',
  model: 'llama-3.1-8b-instant',
  temperature: 0.3,
  maxTokens: 1500,
  maxInputChars: 12000,
};

export class BaseAgent {
  protected config: AgentConfig;
  private llmProvider: LLMProvider;

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llmProvider = createLLMProvider();
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private compactData(data: string): string {
    if (data.length <= this.config.maxInputChars) {
      return data;
    }

    const marker = '\n\n[Content truncated to stay within model request limits]\n\n';
    const remainingChars = Math.max(this.config.maxInputChars - marker.length, 0);
    const headChars = Math.ceil(remainingChars * 0.65);
    const tailChars = remainingChars - headChars;
    const tail = tailChars > 0 ? data.slice(-tailChars) : '';

    return `${data.slice(0, headChars)}${marker}${tail}`;
  }

  private isOversizedRequest(error: any): boolean {
    const message = String(error?.message ?? '');
    const status = error?.status ?? error?.statusCode;

    return status === 413 || /request too large/i.test(message);
  }

  async execute(prompt: string, data: string): Promise<{ result: any; tokens: number; duration: number }> {
    const maxRetries = 5;
    const compactedData = this.compactData(data);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.llmProvider.chat(prompt, compactedData, {
          model: this.config.model,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        });
      } catch (error: any) {
        if (this.isOversizedRequest(error)) {
          throw new Error(
            `Agent ${this.config.name} request is too large for the configured model after compaction. ` +
            `Input chars: ${compactedData.length}, max output tokens: ${this.config.maxTokens}. ${error.message}`
          );
        }

        const isRateLimit = error?.status === 429 || error?.statusCode === 429 ||
          error?.error?.type === 'tokens' || error?.message?.includes('rate_limit');

        if (isRateLimit && attempt < maxRetries) {
          const retryMatch = error.message?.match(/try again in (\d+(?:\.\d+)?)(ms|s)/i);
          let delayMs: number;
          if (retryMatch) {
            delayMs = parseFloat(retryMatch[1]) * (retryMatch[2] === 's' ? 1000 : 1);
            delayMs = Math.max(delayMs, 1000);
          } else {
            delayMs = Math.min(1000 * Math.pow(2, attempt), 30000);
          }

          console.warn(
            `[${this.config.name}] Rate limited (attempt ${attempt + 1}/${maxRetries}). Retrying in ${delayMs}ms...`
          );
          await this.sleep(delayMs);
          continue;
        }

        throw new Error(`Agent ${this.config.name} failed: ${error.message}`);
      }
    }

    throw new Error(`Agent ${this.config.name} failed: Max retries exceeded`);
  }
}
