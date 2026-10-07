import { Router } from 'express';
import {
  getArticles,
  createArticle,
  updateArticle,
  deleteArticle
} from '../controllers/article.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, getArticles);
router.post('/', requireAuth, createArticle);
router.put('/:id', requireAuth, updateArticle);
router.delete('/:id', requireAuth, deleteArticle);

export default router;
