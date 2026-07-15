/**
 * Global test setup — sets env vars BEFORE any module imports.
 *
 * The gateway holds no LLM credentials any more (all AI work lives in the Python
 * service, and there is no fallback), so there is nothing here for Groq, OpenAI,
 * Gemini or Ollama.
 */
process.env.JWT_SECRET = 'test-secret-key-1234567890';
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';
process.env.PYTHON_SERVICE_URL = 'http://localhost:8000';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.STORAGE_PROVIDER = 'local';
