/**
 * Application clock. All timestamps are written through this module (ISO-8601 UTC) so that
 * SLA / escalation logic and seed data can run against a controlled time.
 */
let fixed: Date | null = null;
let offsetMs = 0;

export function now(): Date {
  return fixed ? new Date(fixed.getTime()) : new Date(Date.now() + offsetMs);
}

export function nowIso(): string {
  return now().toISOString();
}

export function today(): string {
  return nowIso().slice(0, 10);
}

/** Freeze the clock (tests, seed). Pass null to release. */
export function setClock(date: Date | string | null): void {
  fixed = date === null ? null : new Date(date);
}

export function advanceClock(ms: number): void {
  if (fixed) fixed = new Date(fixed.getTime() + ms);
  else offsetMs += ms;
}

export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3600_000).toISOString();
}
