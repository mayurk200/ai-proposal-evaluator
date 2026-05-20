import { LLMProvider } from './types';
import { env } from '../../config/env';

export function createLLMProvider(): LLMProvider {
  const provider = (env.LLM_PROVIDER ?? 'groq').toLowerCase();

  switch (provider) {
    case 'groq': {
      if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is required for groq provider');
      const { GroqProvider } = require('./groq.provider');
      return new GroqProvider(env.GROQ_API_KEY);
    }
    case 'openai': {
      if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for openai provider');
      const { OpenAIProvider } = require('./openai.provider');
      return new OpenAIProvider(env.OPENAI_API_KEY);
    }
    case 'gemini': {
      if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for gemini provider');
      const { GeminiProvider } = require('./gemini.provider');
      return new GeminiProvider(env.GEMINI_API_KEY);
    }
    case 'ollama': {
      const { OllamaProvider } = require('./ollama.provider');
      return new OllamaProvider(env.OLLAMA_BASE_URL);
    }
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
