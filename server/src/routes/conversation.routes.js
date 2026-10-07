import { Router } from 'express';
import { getConversations, getConversationMessages } from '../controllers/conversation.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, getConversations);
router.get('/:id/messages', requireAuth, getConversationMessages);

export default router;
