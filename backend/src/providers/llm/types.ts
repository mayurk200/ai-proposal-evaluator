export interface LLMResponse {
  result: any;
  tokens: number;
  duration: number;
}

export interface LLMProvider {
  chat(prompt: string, data: string, config: LLMConfig): Promise<LLMResponse>;
}

export interface LLMConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}
