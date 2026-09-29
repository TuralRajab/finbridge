import jwt from 'jsonwebtoken';
import { config } from '../config';

interface TokenPayload {
  sub: string;
}

export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, { expiresIn: config.jwtTtlSeconds });
}

export function verifyToken(token: string): number | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    const id = Number(payload.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
