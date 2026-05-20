import Groq from 'groq-sdk';
import { LLMProvider, LLMConfig, LLMResponse } from './types';

export class GroqProvider implements LLMProvider {
  private client: Groq;

  constructor(apiKey: string) {
    this.client = new Groq({ apiKey });
  }

  async chat(prompt: string, data: string, config: LLMConfig): Promise<LLMResponse> {
    const startTime = Date.now();
    const completion = await this.client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are an expert AI analyst. Always respond with valid JSON only. No markdown, no code blocks, just pure JSON.',
        },
        { role: 'user', content: prompt + data },
      ],
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
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
  }
}
