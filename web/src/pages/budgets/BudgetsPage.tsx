import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { BudgetDetailDto, BudgetDto } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Button, Card, Empty, ErrorMessage, Field, Icon, Input, Modal, PageHeader, Select, Spinner, VersionStatusBadge } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { date, money, parseAmount } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { DetailedError } from './budgetUi';
import '../../styles/budgets.css';

const az = {
  title: 'Büdcələr',
  subtitle: 'Maliyyə illəri üzrə büdcələr, versiyalar və planlaşdırmanın gedişi',
  create: 'Yeni büdcə',
  year: 'Maliyyə ili',
  name: 'Ad',
  current: 'Cari versiya',
  approved: 'Təsdiqlənmiş versiya',
  total: 'Cəmi',
  progress: 'Planlama',
  progressLabel: '{done} / {total} bölmə təsdiqlənib',
  noSections: 'Bölmə yoxdur',
  createdAt: 'Yaradılıb',
  empty: 'Hələ büdcə yaradılmayıb.',
  emptyHint: 'İlk büdcəni yaradın: boş başlaya və ya əvvəlki ilin büdcəsini faizlə artıraraq köçürə bilərsiniz.',
  newTitle: 'Yeni büdcə yaratmaq',
  nameDefault: '{year} illik büdcəsi',
  copyFrom: 'Əsas götürülən büdcə',
  copyNone: 'Boş büdcə (sətirsiz)',
  copyHint: 'Seçilmiş büdcənin cari versiyasının sətirləri yeni qaralamaya köçürülür.',
  uplift: 'Artım / azalma, %',
  upliftHint: 'Köçürülən bütün aylıq məbləğlərə tətbiq olunur (məs. 5 və ya −3).',
  yearExists: 'Bu il üçün büdcə artıq var.',
  version: 'v{n}',
  none: 'yoxdur',
  invalidYear: 'İl 2000–2100 arasında olmalıdır.',
  invalidUplift: 'Faiz düzgün deyil.',
};
const TEXT = {
  az,
  en: {
    title: 'Budgets',
    subtitle: 'Budgets by fiscal year, their versions and planning progress',
    create: 'New budget',
    year: 'Fiscal year',
    name: 'Name',
    current: 'Current version',
    approved: 'Approved version',
    total: 'Total',
    progress: 'Planning',
    progressLabel: '{done} / {total} sections approved',
    noSections: 'No sections',
    createdAt: 'Created',
    empty: 'No budgets yet.',
    emptyHint: 'Create the first budget: start empty or copy last year\'s budget with an uplift.',
    newTitle: 'Create a new budget',
    nameDefault: 'Budget {year}',
    copyFrom: 'Base on budget',
    copyNone: 'Empty budget (no lines)',
    copyHint: 'Lines of the selected budget\'s current version are copied into the new draft.',
    uplift: 'Uplift / reduction, %',
    upliftHint: 'Applied to every copied monthly amount (e.g. 5 or −3).',
    yearExists: 'A budget for this year already exists.',
    version: 'v{n}',
    none: 'none',
    invalidYear: 'The year must be between 2000 and 2100.',
    invalidUplift: 'Invalid percentage.',
  } satisfies typeof az,
};

export function BudgetsPage() {
  const L = useLocal(TEXT);
  const { locale } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data, error, loading } = useAsync(async () => {
    const budgets = await api<BudgetDto[]>('GET', '/budgets');
    // section progress lives on the detail; budgets per company are few (one per fiscal year)
    const details = await Promise.all(budgets.map((b) => api<BudgetDetailDto>('GET', `/budgets/${b.id}`).catch(() => null)));
    return budgets.map((b, i) => ({ budget: b, detail: details[i] }));
  }, []);

  const versionNo = (d: BudgetDetailDto | null, id: number | null) => (id && d ? d.versions.find((v) => v.id === id)?.versionNo ?? null : null);

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle}
        actions={can('budget.create') && <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" /> {L.create}</Button>} />
      <ErrorMessage error={error} />
      <Card flush>
        {loading && !data ? <Spinner /> : !data?.length ? (
          <Empty>
            <p><b>{L.empty}</b></p>
            {can('budget.create') && <p className="small">{L.emptyHint}</p>}
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{L.year}</th><th>{L.name}</th><th>{L.current}</th><th>{L.approved}</th>
                <th className="r">{L.total}</th><th>{L.progress}</th><th>{L.createdAt}</th>
              </tr></thead>
              <tbody>
                {data.map(({ budget: b, detail: d }) => {
                  const withLines = d?.sections.filter((s) => s.lineCount > 0 || s.status !== 'NOT_STARTED') ?? [];
                  const done = withLines.filter((s) => s.status === 'APPROVED').length;
                  const approvedNo = versionNo(d, b.approvedVersionId);
                  return (
                    <tr key={b.id} className="clickable" onClick={() => navigate(`/budgets/${b.id}`)}>
                      <td className="num"><b>{b.fiscalYear}</b></td>
                      <td><Link to={`/budgets/${b.id}`} onClick={(e) => e.stopPropagation()}>{b.name}</Link></td>
                      <td>
                        {b.currentStatus ? (
                          <span className="nowrap">{b.currentVersionNo !== null && <span className="ver-chip">{fmt(L.version, { n: b.currentVersionNo })}</span>} <VersionStatusBadge status={b.currentStatus} /></span>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td>{approvedNo !== null ? <span className="ver-chip">{fmt(L.version, { n: approvedNo })}</span> : <span className="muted">{L.none}</span>}</td>
                      <td className="r num"><b>{money(b.total, locale)}</b> <span className="muted small">{b.currency}</span></td>
                      <td className="progress-cell">
                        {!d ? <span className="muted">—</span> : withLines.length === 0 ? <span className="muted small">{L.noSections}</span> : (
                          <>
                            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={withLines.length} aria-valuenow={done}
                              aria-label={fmt(L.progressLabel, { done, total: withLines.length })}>
                              <span style={{ width: `${(done / withLines.length) * 100}%` }} />
                            </div>
                            <span className="small muted">{fmt(L.progressLabel, { done, total: withLines.length })}</span>
                          </>
                        )}
                      </td>
                      <td className="small">{date(b.createdAt, locale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <CreateBudgetModal budgets={data?.map((x) => x.budget) ?? []} onClose={() => setCreating(false)}
        onCreated={(b) => navigate(`/budgets/${b.id}`)} />}
    </>
  );
}

function CreateBudgetModal({ budgets, onClose, onCreated }: { budgets: BudgetDto[]; onClose: () => void; onCreated: (b: BudgetDetailDto) => void }) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const nextYear = useMemo(() => (budgets.length ? Math.max(...budgets.map((b) => b.fiscalYear)) + 1 : new Date().getFullYear()), [budgets]);
  const [year, setYear] = useState(String(nextYear));
  const [name, setName] = useState('');
  const latest = budgets.length ? [...budgets].sort((a, b) => b.fiscalYear - a.fiscalYear)[0] : null;
  const [copyFrom, setCopyFrom] = useState<string>(latest ? String(latest.id) : '');
  const [uplift, setUplift] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const y = Number(year);
  const yearOk = Number.isInteger(y) && y >= 2000 && y <= 2100;
  const exists = budgets.some((b) => b.fiscalYear === y);
  const upliftN = parseAmount(uplift.replace('−', '-'));
  const upliftOk = upliftN !== null && upliftN >= -100 && upliftN <= 1000;
  const finalName = name.trim() || fmt(L.nameDefault, { year: y || '' });

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const b = await api<BudgetDetailDto>('POST', '/budgets', {
        fiscalYear: y, name: finalName, copyFromBudgetId: copyFrom ? Number(copyFrom) : null, upliftPct: copyFrom ? upliftN ?? 0 : 0,
      });
      onCreated(b);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal title={L.newTitle} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} disabled={!yearOk || exists || !upliftOk || finalName.length < 2} onClick={submit}>{t('common.create')}</Button>
    </>}>
      <div className="grid-2">
        <Field label={L.year} error={!yearOk ? L.invalidYear : exists ? L.yearExists : undefined}>
          {(id) => <Input id={id} type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />}
        </Field>
        <Field label={L.name}>
          {(id) => <Input id={id} value={name} placeholder={fmt(L.nameDefault, { year: y || '' })} maxLength={120} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>
      <Field label={L.copyFrom} hint={copyFrom ? L.copyHint : undefined}>
        {(id) => <Select id={id} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}
          options={[{ value: '', label: L.copyNone }, ...budgets.map((b) => ({ value: b.id, label: `${b.fiscalYear} · ${b.name}` }))]} />}
      </Field>
      {copyFrom && (
        <Field label={L.uplift} hint={L.upliftHint} error={!upliftOk ? L.invalidUplift : undefined}>
          {(id) => <Input id={id} inputMode="decimal" value={uplift} onChange={(e) => setUplift(e.target.value)} />}
        </Field>
      )}
      <DetailedError error={error} />
    </Modal>
  );
}
