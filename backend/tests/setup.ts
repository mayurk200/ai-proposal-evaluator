/**
 * Global test setup — sets env vars BEFORE any module imports.
 */
process.env.JWT_SECRET = 'test-secret-key-1234567890';
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';
process.env.PYTHON_SERVICE_URL = 'http://localhost:8000';
process.env.LLM_PROVIDER = 'groq';
process.env.GROQ_API_KEY = 'test-groq-key';
process.env.STORAGE_PROVIDER = 'local';
process.env.UPLOAD_DIR = '/tmp/agrieval-test-uploads';
