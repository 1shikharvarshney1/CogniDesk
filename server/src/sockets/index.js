import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { env } from '../config/env.js';
import { registerAgentHandlers } from './agentHandlers.js';
import { registerCustomerHandlers } from './customerHandlers.js';

export function setupSocketIO(server) {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Handshake authentication middleware
  io.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth || {};

      // 1. Agent authentication via JWT token
      if (auth.token) {
        try {
          const decoded = jwt.verify(auth.token, env.JWT_SECRET);
          const user = await User.findById(decoded.id).populate('workspace');
          if (!user) {
            return next(new Error('Unauthorized'));
          }

          socket.data.role = 'agent';
          socket.data.user = user;
          return next();
        } catch (jwtErr) {
          return next(new Error('Unauthorized'));
        }
      }

      // 2. Customer guest authentication via workspace publicKey
      if (auth.publicKey) {
        const workspace = await Workspace.findOne({ publicKey: auth.publicKey });
        if (!workspace) {
          return next(new Error('Workspace not found'));
        }

        socket.data.role = 'customer';
        socket.data.workspace = workspace;
        socket.data.workspaceId = workspace._id.toString();
        socket.data.visitorId = auth.visitorId || null;
        return next();
      }

      // Reject unauthenticated connections
      return next(new Error('Unauthorized'));
    } catch (err) {
      return next(new Error('Unauthorized'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    if (socket.data.role === 'agent') {
      // Agents auto-join their workspace room
      const user = socket.data.user;
      if (user?.workspace) {
        const wsId = user.workspace._id?.toString() || user.workspace.toString();
        socket.join(`ws:${wsId}`);
      }
      registerAgentHandlers(io, socket);
    } else if (socket.data.role === 'customer') {
      registerCustomerHandlers(io, socket);
    }
  });

  return io;
}
