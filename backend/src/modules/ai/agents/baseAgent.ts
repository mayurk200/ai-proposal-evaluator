import Groq from 'groq-sdk';
import { env } from '../../../config/env';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export interface AgentConfig {
  name: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  name: 'BaseAgent',
  model: 'llama-3.1-8b-instant',
  temperature: 0.3,
  maxTokens: 4096,
};

export class BaseAgent {
  protected config: AgentConfig;

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async execute(prompt: string, data: string): Promise<{ result: any; tokens: number; duration: number }> {
    const startTime = Date.now();
    const maxRetries = 5;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [
            {
              role: 'system',
              content: 'You are an expert AI analyst. Always respond with valid JSON only. No markdown, no code blocks, just pure JSON.',
            },
            {
              role: 'user',
              content: prompt + data,
            },
          ],
          model: this.config.model,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          response_format: { type: 'json_object' },
        });

        const duration = Date.now() - startTime;
        const responseText = completion.choices[0]?.message?.content || '{}';
        const tokens = completion.usage?.total_tokens || 0;

        let result;
        try {
          result = JSON.parse(responseText);
        } catch {
          result = { error: 'Failed to parse AI response', raw: responseText };
        }

        return { result, tokens, duration };
      } catch (error: any) {
        const isRateLimit = error?.status === 429 || error?.statusCode === 429 ||
          error?.error?.type === 'tokens' || error?.message?.includes('rate_limit');

        if (isRateLimit && attempt < maxRetries) {
          // Parse retry delay from error message, or use exponential backoff
          const retryMatch = error.message?.match(/try again in (\d+(?:\.\d+)?)(ms|s)/i);
          let delayMs: number;
          if (retryMatch) {
            delayMs = parseFloat(retryMatch[1]) * (retryMatch[2] === 's' ? 1000 : 1);
            delayMs = Math.max(delayMs, 1000); // At least 1 second
          } else {
            delayMs = Math.min(1000 * Math.pow(2, attempt), 30000); // Exponential backoff, max 30s
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
