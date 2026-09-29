import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ErrorCode } from '@finbridge/shared';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have permission for this action') => new HttpError(403, 'FORBIDDEN', message);
export const badRequest = (code: ErrorCode, message: string, details?: unknown) => new HttpError(400, code, message, details);
export const conflict = (code: ErrorCode, message: string) => new HttpError(409, code, message);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.issues } });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  const msg = String((err as Error)?.message ?? err);
  if (msg.includes('UNIQUE constraint failed')) {
    res.status(409).json({ error: { code: 'DUPLICATE_CODE', message: 'A record with this code already exists' } });
    return;
  }
  if (msg.includes('FOREIGN KEY constraint failed')) {
    res.status(409).json({ error: { code: 'IN_USE', message: 'The record is referenced by other data' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
};
