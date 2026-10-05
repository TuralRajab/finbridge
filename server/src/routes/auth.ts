import { Router } from 'express';
import { z } from 'zod';
import { permissionsFor, type MeDto } from '@finbridge/shared';
import { get, run } from '../db/database';
import { currentUser, requireAuth } from '../auth/middleware';
import { hashPassword, verifyPassword } from '../auth/password';
import { signToken } from '../auth/token';
import { HttpError } from '../lib/errors';
import { assertLicense, type CompanyRow } from '../lib/license';
import { toCompanyDto, toUserDto, type UserRow } from '../lib/mappers';
import { nowIso } from '../lib/clock';
import { inbox } from '../services/workflowEngine';

export const authRouter = Router();

function meDto(user: UserRow): MeDto {
  const company = user.company_id ? get<CompanyRow>('SELECT * FROM companies WHERE id = ?', user.company_id) : undefined;
  return { ...toUserDto(user), permissions: permissionsFor(user.role), company: company ? toCompanyDto(company) : null, pendingTasks: user.company_id ? inbox(user).length : 0 };
}

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

authRouter.post('/login', (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = get<UserRow>('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  if (user.is_active !== 1) throw new HttpError(403, 'USER_INACTIVE', 'User is deactivated');
  if (user.company_id !== null) {
    const company = get<CompanyRow>('SELECT * FROM companies WHERE id = ?', user.company_id);
    if (!company) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    assertLicense(company);
  }
  run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
  res.json({ token: signToken(user.id), user: meDto(user) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(meDto(currentUser(req)));
});

const updateMeSchema = z.object({
  language: z.enum(['az', 'en']).optional(),
  fullName: z.string().trim().min(2).max(120).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(200).optional(),
});

authRouter.patch('/me', requireAuth, (req, res) => {
  const user = currentUser(req);
  const body = updateMeSchema.parse(req.body);
  if (body.newPassword) {
    if (!body.currentPassword || !verifyPassword(body.currentPassword, user.password_hash)) {
      throw new HttpError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.newPassword), user.id);
  }
  if (body.language) run('UPDATE users SET language = ? WHERE id = ?', body.language, user.id);
  if (body.fullName) run('UPDATE users SET full_name = ? WHERE id = ?', body.fullName, user.id);
  res.json(meDto(get<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!));
});
