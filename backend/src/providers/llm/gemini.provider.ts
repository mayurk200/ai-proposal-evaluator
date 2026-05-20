import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMConfig, LLMResponse } from './types';

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async chat(prompt: string, data: string, config: LLMConfig): Promise<LLMResponse> {
    const startTime = Date.now();
    const model = this.client.getGenerativeModel({ 
      model: config.model,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
      },
    });

    const result = await model.generateContent(
      `You are an expert AI analyst. Always respond with valid JSON only. No markdown, no code blocks, just pure JSON.\n\n${prompt}${data}`
    );
    const response = result.response;
    const duration = Date.now() - startTime;
    const responseText = response.text();
    const tokens = response.usageMetadata?.totalTokenCount || 0;

    let parsedResult;
    try {
      parsedResult = JSON.parse(responseText);
    } catch {
      parsedResult = { error: 'Failed to parse AI response', raw: responseText };
    }

    return { result: parsedResult, tokens, duration };
  }
}
