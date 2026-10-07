import { Router } from 'express';
import { createWorkspace, joinWorkspace, getMyWorkspace } from '../controllers/workspace.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/', requireAuth, createWorkspace);
router.post('/join', requireAuth, joinWorkspace);
router.get('/', requireAuth, getMyWorkspace);

export default router;
