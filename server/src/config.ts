import fs from 'node:fs';
import path from 'node:path';

const serverRoot = path.resolve(import.meta.dirname, '..');
const envFile = path.resolve(serverRoot, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET ?? 'finbridge-local-development-secret';
if (isProduction && (!process.env.JWT_SECRET || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be set (min. 32 characters) when NODE_ENV=production');
}

const dbFile = process.env.DATABASE_FILE ?? 'data/finbridge.db';

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret,
  /** Token lifetime in seconds (12 hours). */
  jwtTtlSeconds: 60 * 60 * 12,
  dbFile: dbFile === ':memory:' ? dbFile : path.resolve(serverRoot, dbFile),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  webDist: path.resolve(serverRoot, '..', 'web', 'dist'),
  maxUploadBytes: 10 * 1024 * 1024,
};
