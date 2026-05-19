import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './modules/auth/auth.routes';
import proposalRoutes from './modules/proposal/proposal.routes';
import aiRoutes from './modules/ai/ai.routes';
import comparisonRoutes from './modules/comparison/comparison.routes';

const app = express();

// Ensure upload directory exists
const uploadDir = path.resolve(env.UPLOAD_DIR);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/uploads', express.static(uploadDir));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/comparisons', comparisonRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

// Error handler
app.use(errorHandler);

// Start server
const PORT = parseInt(env.PORT);
app.listen(PORT, () => {
  console.log(`🚀 AgriEval API running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${env.NODE_ENV}`);
});

export default app;
