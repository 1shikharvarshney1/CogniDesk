import { Router } from 'express';
import { Workspace } from '../models/Workspace.js';
import { AppError } from '../utils/errors.js';

const router = Router();

router.get('/:publicKey', async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    const workspace = await Workspace.findOne({ publicKey });

    if (!workspace) {
      throw new AppError('Workspace not found with provided public key', 404);
    }

    return res.json({ workspaceName: workspace.name });
  } catch (err) {
    next(err);
  }
});

export default router;
