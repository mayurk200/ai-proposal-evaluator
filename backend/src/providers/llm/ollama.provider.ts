import { LLMProvider, LLMConfig, LLMResponse } from './types';

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  async chat(prompt: string, data: string, config: LLMConfig): Promise<LLMResponse> {
    const startTime = Date.now();
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt: `You are an expert AI analyst. Always respond with valid JSON only. No markdown, no code blocks, just pure JSON.\n\n${prompt}${data}`,
        stream: false,
        options: {
          temperature: config.temperature,
          num_predict: config.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const json = await response.json();
    const duration = Date.now() - startTime;
    const responseText = json.response || '{}';
    const tokens = json.eval_count || 0;

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { error: 'Failed to parse AI response', raw: responseText };
    }

    return { result, tokens, duration };
  }
}
