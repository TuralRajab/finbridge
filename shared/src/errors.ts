/** Machine-readable error codes returned by the API. The web app translates them. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'USER_INACTIVE',
  'LICENSE_EXPIRED',
  'LICENSE_SUSPENDED',
  'LICENSE_SEAT_LIMIT',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'DUPLICATE_CODE',
  'IN_USE',
  'INVALID_TRANSITION',
  'COMMENT_REQUIRED',
  'SECTIONS_NOT_APPROVED',
  'BUDGET_NOT_EDITABLE',
  'VERSION_LOCKED',
  'NO_WORKFLOW',
  'NO_APPROVER',
  'NOT_ASSIGNEE',
  'INVALID_HIERARCHY',
  'OVER_BUDGET',
  'ACCOUNT_NOT_ALLOWED',
  'SETUP_REQUIRED',
  'BUDGET_EXISTS',
  'IMPORT_FAILED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}
