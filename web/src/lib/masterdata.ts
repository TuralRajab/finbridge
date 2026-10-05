import type { AccountDto, CostCenterDto, OrgUnitDto, UserDto } from '@finbridge/shared';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { useAsync } from './useAsync';

/** Reference data used by pickers and filters. Load once per page; call `reload` after admin edits. */
export interface MasterData {
  units: OrgUnitDto[];
  costCenters: CostCenterDto[];
  accounts: AccountDto[];
  users: UserDto[];
}

export function useMasterData(opts: { users?: boolean } = {}) {
  return useAsync<MasterData>(async () => {
    const [units, costCenters, accounts, users] = await Promise.all([
      api<OrgUnitDto[]>('GET', '/org/units'),
      api<CostCenterDto[]>('GET', '/cost-centers'),
      api<AccountDto[]>('GET', '/accounts'),
      opts.users ? api<UserDto[]>('GET', '/users') : Promise.resolve([] as UserDto[]),
    ]);
    return { units, costCenters, accounts, users };
  }, [opts.users]);
}

/** Localised display name for records that carry an optional English name. */
export function useDisplayName() {
  const { lang } = useI18n();
  return (r: { name: string; nameEn?: string | null }) => (lang === 'en' && r.nameEn ? r.nameEn : r.name);
}

/** Indented option list for a tree (accounts, org units). `level` starts at 0. */
export function treeOptions<T extends { id: number; parentId: number | null; code: string }>(
  rows: T[], label: (r: T) => string, filter: (r: T) => boolean = () => true,
): { value: number; label: string; row: T }[] {
  const byParent = new Map<number | null, T[]>();
  for (const r of rows) {
    const k = rows.some((p) => p.id === r.parentId) ? r.parentId : null;
    byParent.set(k, [...(byParent.get(k) ?? []), r]);
  }
  const out: { value: number; label: string; row: T }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const r of (byParent.get(parent) ?? []).sort((a, b) => a.code.localeCompare(b.code))) {
      if (filter(r)) out.push({ value: r.id, label: `${'  '.repeat(depth)}${r.code} · ${label(r)}`, row: r });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Budgetable / requestable leaf accounts, optionally limited by a cost center's restriction list. */
export function usableAccounts(accounts: AccountDto[], cc: CostCenterDto | undefined, purpose: 'budget' | 'request'): AccountDto[] {
  return accounts.filter((a) =>
    a.isActive && !a.isGroup && (purpose === 'budget' ? a.allowBudgeting : a.allowRequests)
    && (!cc || cc.allowedAccountIds.length === 0 || cc.allowedAccountIds.includes(a.id)));
}
