import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BudgetDetailDto, BudgetDto } from '@finbridge/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BudgetStatusBadge, Button, Card, Empty, ErrorMessage, Field, Icon, Input, Modal, PageHeader, Select, Spinner } from '../components/ui';
import { useI18n } from '../i18n';
import { date, money } from '../lib/format';
import { useAsync } from '../lib/useAsync';

export function BudgetsPage() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error } = useAsync(() => api<BudgetDto[]>('GET', '/budgets'), []);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader title={t('budgets.title')} subtitle={t('budgets.subtitle')}
        actions={can('budget.create') && <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" /> {t('budgets.new')}</Button>} />
      <Card flush>
        {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : !data?.length ? <Empty>{t('budgets.empty')}</Empty> : (
          <table className="table">
            <thead><tr>
              <th>{t('common.year')}</th><th>{t('budgets.name')}</th><th>{t('common.status')}</th>
              <th className="r">{t('budgets.lines')}</th><th className="r">{t('common.total')} (AZN)</th><th>{t('budgets.createdAt')}</th><th />
            </tr></thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => navigate(`/budgets/${b.id}`)}>
                  <td><b>{b.year}</b></td>
                  <td>{b.name}</td>
                  <td><BudgetStatusBadge status={b.status} /></td>
                  <td className="r num">{b.lineCount}</td>
                  <td className="r num">{money(b.total, locale)}</td>
                  <td className="muted">{date(b.createdAt, locale)}</td>
                  <td className="r muted"><Icon name="chevron" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {creating && <NewBudgetModal budgets={data ?? []} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/budgets/${id}`)} />}
    </>
  );
}

function NewBudgetModal({ budgets, onClose, onCreated }: { budgets: BudgetDto[]; onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useI18n();
  const nextYear = Math.max(new Date().getFullYear() + 1, ...budgets.map((b) => b.year + 1));
  const [year, setYear] = useState(String(nextYear));
  const [name, setName] = useState(t('budgets.defaultName', { year: nextYear }));
  const [copyFrom, setCopyFrom] = useState(budgets[0] ? String(budgets[0].id) : '');
  const [uplift, setUplift] = useState('5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const b = await api<BudgetDetailDto>('POST', '/budgets', {
        year: Number(year), name, copyFromBudgetId: copyFrom ? Number(copyFrom) : null, upliftPct: copyFrom ? Number(uplift || 0) : 0,
      });
      onCreated(b.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal title={t('budgets.new')} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} onClick={submit}>{t('common.create')}</Button>
    </>}>
      <div className="grid-2">
        <Field label={t('common.year')}>{(id) => <Input id={id} type="number" value={year} onChange={(e) => { setYear(e.target.value); setName(name.replace(/\d{4}/, e.target.value)); }} />}</Field>
        <Field label={t('budgets.name')}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      </div>
      <div className="grid-2">
        <Field label={t('budgets.copyFrom')}>
          {(id) => <Select id={id} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}
            options={[{ value: '', label: t('budgets.copyNone') }, ...budgets.map((b) => ({ value: b.id, label: `${b.name} (${b.year})` }))]} />}
        </Field>
        {copyFrom && <Field label={t('budgets.uplift')} hint={t('budgets.upliftHint')}>{(id) => <Input id={id} type="number" step="0.5" value={uplift} onChange={(e) => setUplift(e.target.value)} />}</Field>}
      </div>
      <ErrorMessage error={error} />
    </Modal>
  );
}
