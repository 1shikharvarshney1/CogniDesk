import { z } from 'zod';
import { Workspace } from '../models/Workspace.js';
import { generatePublicKey, generateJoinCode } from '../utils/keys.js';
import { AppError } from '../utils/errors.js';

const createWorkspaceSchema = z.object({
  name: z.string().min(2, 'Workspace name must be at least 2 characters').trim()
});

const joinWorkspaceSchema = z.object({
  joinCode: z.string().min(6, 'Join code must be 6 characters').trim().toUpperCase()
});

export async function createWorkspace(req, res, next) {
  try {
    const { name } = createWorkspaceSchema.parse(req.body);

    // Generate unique random keys
    let publicKey = generatePublicKey();
    let joinCode = generateJoinCode();

    // Ensure uniqueness
    while (await Workspace.findOne({ publicKey })) {
      publicKey = generatePublicKey();
    }
    while (await Workspace.findOne({ joinCode })) {
      joinCode = generateJoinCode();
    }

    const workspace = await Workspace.create({
      name,
      publicKey,
      joinCode,
      owner: req.user._id
    });

    req.user.workspace = workspace._id;
    await req.user.save();

    return res.status(201).json({ workspace });
  } catch (err) {
    next(err);
  }
}

export async function joinWorkspace(req, res, next) {
  try {
    const { joinCode } = joinWorkspaceSchema.parse(req.body);

    const workspace = await Workspace.findOne({ joinCode });
    if (!workspace) {
      throw new AppError('Invalid join code. Workspace not found.', 404);
    }

    req.user.workspace = workspace._id;
    await req.user.save();

    return res.json({ workspace });
  } catch (err) {
    next(err);
  }
}

export async function getMyWorkspace(req, res, next) {
  try {
    if (!req.user.workspace) {
      throw new AppError('No workspace associated with your account yet.', 404);
    }

    const workspace = await Workspace.findById(req.user.workspace._id || req.user.workspace);
    if (!workspace) {
      throw new AppError('Workspace not found.', 404);
    }

    return res.json({
      name: workspace.name,
      publicKey: workspace.publicKey,
      joinCode: workspace.joinCode,
      _id: workspace._id,
      owner: workspace.owner
    });
  } catch (err) {
    next(err);
  }
}
