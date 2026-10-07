import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

// Central error-handling middleware returning consistent { message } JSON
export function errorHandler(err, req, res, next) {
  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const message = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return res.status(400).json({ message: `Validation error: ${message}` });
  }

  // Handle custom AppError
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  // Handle Mongoose CastError / ValidationError
  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid ID format: ${err.value}` });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }

  // Log server internal errors
  console.error('[ServerError]', err);

  const status = err.statusCode || err.status || 500;
  return res.status(status).json({ message: err.message || 'Internal Server Error' });
}
