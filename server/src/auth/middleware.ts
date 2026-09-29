import type { NextFunction, Request, Response } from 'express';
import { can, type Permission } from '@finbridge/shared';
import { get } from '../db/database';
import { forbidden, HttpError } from '../lib/errors';
import { assertLicense, type CompanyRow } from '../lib/license';
import type { UserRow } from '../lib/mappers';
import { verifyToken } from './token';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

/** Verifies the bearer token, reloads the user and enforces active user + valid company licence. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token ? verifyToken(token) : null;
  if (!userId) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in required');

  const user = get<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in required');
  if (user.is_active !== 1) throw new HttpError(403, 'USER_INACTIVE', 'User is deactivated');
  if (user.company_id !== null) {
    const company = get<CompanyRow>('SELECT * FROM companies WHERE id = ?', user.company_id);
    if (!company) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in required');
    assertLicense(company);
  }
  req.user = user;
  next();
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = currentUser(req);
    if (!permissions.every((p) => can(user.role, p))) throw forbidden();
    next();
  };
}

export function currentUser(req: Request): UserRow {
  if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in required');
  return req.user;
}

/** Company of the signed-in user. Platform super admins have no company and are rejected here. */
export function companyIdOf(req: Request): number {
  const user = currentUser(req);
  if (user.company_id === null) throw forbidden('This endpoint is only available inside a company');
  return user.company_id;
}
