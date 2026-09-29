import { z } from 'zod';

export const idParam = z.coerce.number().int().positive();

export function toId(value: unknown): number {
  return idParam.parse(value);
}

export const monthsSchema = z.array(z.number().finite().min(-1e12).max(1e12)).length(12);

export const nullableId = z.number().int().positive().nullable().optional();
