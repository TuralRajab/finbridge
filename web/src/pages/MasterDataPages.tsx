import type { AccountDto, CostCenterDto, DepartmentDto, UserDto } from '@finbridge/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CrudPage } from '../components/CrudPage';
import { Badge } from '../components/ui';
import { useI18n } from '../i18n';
import { useAsync } from '../lib/useAsync';

const activeBadge = (active: boolean, t: ReturnType<typeof useI18n>['t']) =>
  <Badge tone={active ? 'success' : 'neutral'}>{active ? t('common.active') : t('common.inactive')}</Badge>;

function useUserOptions() {
  const { t } = useI18n();
  const { data } = useAsync(() => api<UserDto[]>('GET', '/users'), []);
  return [{ value: '', label: t('common.none') }, ...(data ?? []).filter((u) => u.isActive).map((u) => ({ value: u.id, label: u.fullName }))];
}

type DeptForm = { code: string; name: string; managerId: string; isActive: boolean };

export function DepartmentsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const users = useUserOptions();
  return (
    <CrudPage<DepartmentDto, DeptForm>
      title={t('departments.title')} subtitle={t('departments.subtitle')} newLabel={t('departments.new')}
      endpoint="/departments" exportPath="/export/departments" exportName="departments.xlsx" canManage={can('masterdata.manage')}
      columns={[
        { header: t('common.code'), render: (d) => <b>{d.code}</b> },
        { header: t('common.name'), render: (d) => d.name },
        { header: t('departments.manager'), render: (d) => d.managerName ?? '—' },
        { header: t('departments.costCenters'), render: (d) => d.costCenterCount, align: 'right' },
        { header: t('common.status'), render: (d) => activeBadge(d.isActive, t) },
      ]}
      fields={[
        { key: 'code', label: t('common.code'), required: true },
        { key: 'name', label: t('common.name'), required: true },
        { key: 'managerId', label: t('departments.manager'), type: 'select', options: users },
        { key: 'isActive', label: t('common.active'), type: 'checkbox' },
      ]}
      emptyForm={() => ({ code: '', name: '', managerId: '', isActive: true })}
      toForm={(d) => ({ code: d.code, name: d.name, managerId: d.managerId ? String(d.managerId) : '', isActive: d.isActive })}
      toPayload={(f) => ({ code: f.code, name: f.name, managerId: f.managerId ? Number(f.managerId) : null, isActive: f.isActive })}
    />
  );
}

type CcForm = { code: string; name: string; departmentId: string; ownerId: string; isActive: boolean };

export function CostCentersPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const users = useUserOptions();
  const { data: depts } = useAsync(() => api<DepartmentDto[]>('GET', '/departments'), []);
  const deptOptions = (depts ?? []).map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` }));
  return (
    <CrudPage<CostCenterDto, CcForm>
      title={t('costCenters.title')} subtitle={t('costCenters.subtitle')} newLabel={t('costCenters.new')}
      endpoint="/cost-centers" exportPath="/export/cost-centers" exportName="cost-centers.xlsx" canManage={can('masterdata.manage')}
      columns={[
        { header: t('common.code'), render: (c) => <b>{c.code}</b> },
        { header: t('common.name'), render: (c) => c.name },
        { header: t('costCenters.department'), render: (c) => c.departmentName },
        { header: t('costCenters.owner'), render: (c) => c.ownerName ?? '—' },
        { header: t('common.status'), render: (c) => activeBadge(c.isActive, t) },
      ]}
      fields={[
        { key: 'code', label: t('common.code'), required: true },
        { key: 'name', label: t('common.name'), required: true },
        { key: 'departmentId', label: t('costCenters.department'), type: 'select', options: deptOptions },
        { key: 'ownerId', label: t('costCenters.owner'), type: 'select', options: users },
        { key: 'isActive', label: t('common.active'), type: 'checkbox' },
      ]}
      emptyForm={() => ({ code: '', name: '', departmentId: deptOptions[0] ? String(deptOptions[0].value) : '', ownerId: '', isActive: true })}
      toForm={(c) => ({ code: c.code, name: c.name, departmentId: String(c.departmentId), ownerId: c.ownerId ? String(c.ownerId) : '', isActive: c.isActive })}
      toPayload={(f) => ({ code: f.code, name: f.name, departmentId: Number(f.departmentId), ownerId: f.ownerId ? Number(f.ownerId) : null, isActive: f.isActive })}
    />
  );
}

type AccForm = { code: string; name: string; type: string; isActive: boolean };

export function AccountsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  return (
    <CrudPage<AccountDto, AccForm>
      title={t('accounts.title')} subtitle={t('accounts.subtitle')} newLabel={t('accounts.new')}
      endpoint="/accounts" exportPath="/export/accounts" exportName="accounts.xlsx" canManage={can('masterdata.manage')}
      columns={[
        { header: t('common.code'), render: (a) => <b>{a.code}</b> },
        { header: t('common.name'), render: (a) => a.name },
        { header: t('accounts.type'), render: (a) => <Badge tone={a.type === 'CAPEX' ? 'info' : 'neutral'}>{a.type}</Badge> },
        { header: t('common.status'), render: (a) => activeBadge(a.isActive, t) },
      ]}
      fields={[
        { key: 'code', label: t('common.code'), required: true },
        { key: 'name', label: t('common.name'), required: true },
        { key: 'type', label: t('accounts.type'), type: 'select', options: [{ value: 'OPEX', label: 'OPEX' }, { value: 'CAPEX', label: 'CAPEX' }] },
        { key: 'isActive', label: t('common.active'), type: 'checkbox' },
      ]}
      emptyForm={() => ({ code: '', name: '', type: 'OPEX', isActive: true })}
      toForm={(a) => ({ code: a.code, name: a.name, type: a.type, isActive: a.isActive })}
      toPayload={(f) => ({ code: f.code, name: f.name, type: f.type, isActive: f.isActive })}
    />
  );
}
