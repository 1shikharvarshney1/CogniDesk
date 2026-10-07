import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/auth.routes.js';
import workspaceRoutes from './routes/workspace.routes.js';
import conversationRoutes from './routes/conversation.routes.js';
import articleRoutes from './routes/article.routes.js';
import publicRoutes from './routes/public.routes.js';
import { getStats } from './controllers/conversation.controller.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  // Middleware
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  app.use(express.json());
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  // REST API Endpoints
  app.use('/api/auth', authRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api/workspace', workspaceRoutes); // Supports GET /api/workspace
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/articles', articleRoutes);
  app.get('/api/stats', requireAuth, getStats);
  app.use('/api/public', publicRoutes);

  // Central Error Handler
  app.use(errorHandler);

  return app;
}
