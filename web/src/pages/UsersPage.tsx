import { COMPANY_ROLES, type DepartmentDto, type UserDto } from '@finbridge/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CrudPage } from '../components/CrudPage';
import { Badge, Card } from '../components/ui';
import { useI18n } from '../i18n';
import { date } from '../lib/format';
import { useAsync } from '../lib/useAsync';

type UserForm = { fullName: string; email: string; role: string; departmentId: string; language: string; password: string; isActive: boolean };

export function UsersPage() {
  const { t, locale } = useI18n();
  const { user, can, refresh } = useAuth();
  const { data: depts } = useAsync(() => api<DepartmentDto[]>('GET', '/departments'), []);
  const license = user?.company?.license;
  const deptOptions = [{ value: '', label: t('common.none') }, ...(depts ?? []).map((d) => ({ value: d.id, label: d.name }))];
  const roleOptions = COMPANY_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }));

  return (
    <>
      <CrudPage<UserDto, UserForm>
        title={t('users.title')} subtitle={t('users.subtitle')} newLabel={t('users.new')} canDelete={false}
        endpoint="/users" exportPath="/export/users" exportName="users.xlsx" canManage={can('users.manage')}
        banner={license && (
          <div className={`alert ${license.usedUsers >= license.maxUsers ? 'alert-warning' : 'alert-info'}`}>
            {t('users.seats', { used: license.usedUsers, max: license.maxUsers })}
          </div>
        )}
        columns={[
          { header: t('users.fullName'), render: (u) => <b>{u.fullName}</b> },
          { header: t('users.email'), render: (u) => u.email },
          { header: t('users.role'), render: (u) => t(`roles.${u.role}`) },
          { header: t('users.department'), render: (u) => depts?.find((d) => d.id === u.departmentId)?.name ?? '—' },
          { header: t('users.lastLogin'), render: (u) => <span className="muted">{date(u.lastLoginAt, locale, true)}</span> },
          { header: t('common.status'), render: (u) => <Badge tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? t('common.active') : t('common.inactive')}</Badge> },
        ]}
        fields={[
          { key: 'fullName', label: t('users.fullName'), required: true },
          { key: 'email', label: t('users.email'), type: 'email', required: true, createOnly: true },
          { key: 'role', label: t('users.role'), type: 'select', options: roleOptions },
          { key: 'departmentId', label: t('users.department'), type: 'select', options: deptOptions },
          { key: 'language', label: t('users.language'), type: 'select', options: [{ value: 'az', label: 'Azərbaycan' }, { value: 'en', label: 'English' }], createOnly: true },
          { key: 'password', label: t('users.password'), type: 'password', hint: t('users.passwordHint') },
          { key: 'isActive', label: t('common.active'), type: 'checkbox' },
        ]}
        emptyForm={() => ({ fullName: '', email: '', role: 'DEPARTMENT_MANAGER', departmentId: '', language: 'az', password: '', isActive: true })}
        toForm={(u) => ({ fullName: u.fullName, email: u.email, role: u.role, departmentId: u.departmentId ? String(u.departmentId) : '', language: u.language, password: '', isActive: u.isActive })}
        onSaved={() => void refresh()}
        toPayload={(f, isNew) => {
          const base = { fullName: f.fullName, role: f.role, departmentId: f.departmentId ? Number(f.departmentId) : null };
          return isNew
            ? { ...base, email: f.email, language: f.language, password: f.password }
            : { ...base, isActive: f.isActive, ...(f.password ? { password: f.password } : {}) };
        }}
      />
      <Card title={t('users.roleHelp')}>
        <dl className="role-help">
          {COMPANY_ROLES.map((r) => (
            <div key={r}><dt>{t(`roles.${r}`)}</dt><dd>{t(`roleHelp.${r}`)}</dd></div>
          ))}
        </dl>
      </Card>
    </>
  );
}
