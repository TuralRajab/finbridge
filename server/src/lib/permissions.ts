import type { DataScope, Permission } from '@finbridge/shared';
import { effective } from '../services/roles';
import type { UserRow } from './mappers';

/**
 * Effective permission check for a signed-in user. Always use this instead of `can(user.role, …)`:
 * permissions come from the user's configurable company role (built-in or custom).
 */
export function userCan(user: UserRow, permission: Permission): boolean {
  return effective(user).permissions.has(permission);
}

export function userPermissions(user: UserRow): Permission[] {
  return [...effective(user).permissions];
}

export function userScope(user: UserRow): DataScope | null {
  return effective(user).scope;
}
