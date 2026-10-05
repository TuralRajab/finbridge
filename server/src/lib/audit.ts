import { run } from '../db/database';
import { nowIso } from './clock';

/** Append-only audit trail (the table rejects UPDATE). */
export function audit(
  companyId: number | null, userId: number | null, entityType: string, entityId: number | null,
  action: string, changes?: Record<string, unknown> | null,
): void {
  run(
    'INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    companyId, userId, entityType, entityId, action, changes ? JSON.stringify(changes) : null, nowIso(),
  );
}

/** { field: [old, new] } for fields whose value changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> | null {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    if (b !== undefined && JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a ?? null, b];
  }
  return Object.keys(out).length ? out : null;
}
