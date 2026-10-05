import { useEffect, useMemo, useRef, useState } from 'react';
import { MONTH_NAMES, type ActualEntryDto, type ImportReport } from '@finbridge/shared';
import { ApiError, api, download, qs, upload } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Card, Empty, ErrorMessage, ExportButton, Field, Icon, Input, Modal, PageHeader, Select, Spinner, Variance } from '../components/ui';
import { fmt, useI18n, useLocal } from '../i18n';
import { compact, money, parseAmount } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useYear } from '../lib/useYear';
import '../styles/spend.css';

const az = {
  title: 'Faktiki xərclər',
  subtitle: 'Ay üzrə faktiki xərclərin daxil edilməsi. Təsdiqlənmiş sorğulardan qeydə alınan qaimələr avtomatik əks olunur və burada dəyişdirilmir.',
  section: 'Büdcə bölməsi',
  monthBudget: 'Ayın büdcəsi',
  manual: 'Əl ilə daxil edilən',
  fromRequests: 'Sorğulardan',
  fromRequestsHint: 'Təsdiqlənmiş sorğulara bağlı faktlar — sorğu səhifəsindən qeyd edilir.',
  totalActual: 'Cəmi fakt',
  readOnly: 'Sizin rolunuz faktiki xərclərə yalnız baxmağa icazə verir.',
  empty: 'Bu ay üçün büdcə sətri və ya faktiki xərc yoxdur.',
  searchPh: 'Xərc mərkəzi və ya hesab…',
  importTitle: 'Faktiki xərclərin Excel-dən idxalı',
  template: 'Şablon',
  monthHasData: '{m} · {v}',
  rows: '{n} sətir',
  confirmLeave: 'Yadda saxlanmamış dəyişikliklər itəcək. Davam edilsin?',
};
const TEXT = {
  az,
  en: {
    title: 'Actuals',
    subtitle: 'Monthly actual spend entry. Invoices recorded against approved requests appear automatically and cannot be changed here.',
    section: 'Budget section',
    monthBudget: 'Month budget',
    manual: 'Manual entry',
    fromRequests: 'From requests',
    fromRequestsHint: 'Actuals linked to approved requests — recorded on the request page.',
    totalActual: 'Total actual',
    readOnly: 'Your role can view actuals but not change them.',
    empty: 'No budget lines or actuals for this month.',
    searchPh: 'Cost center or account…',
    importTitle: 'Import actuals from Excel',
    template: 'Template',
    monthHasData: '{m} · {v}',
    rows: '{n} rows',
    confirmLeave: 'Unsaved changes will be lost. Continue?',
  } satisfies typeof az,
};

export function ActualsPage() {
  const { t, locale, lang } = useI18n();
  const L = useLocal(TEXT);
  const { user, can } = useAuth();
  const base = user?.company?.baseCurrency ?? 'AZN';
  const { year, setYear, years } = useYear();
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const { data, loading, error, reload } = useAsync(() => api<ActualEntryDto[]>('GET', `/actuals${qs({ year, month })}`), [year, month]);
  const months = useAsync(() => api<{ month: number; total: number }[]>('GET', `/actuals/months${qs({ year })}`), [year]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const editable = can('actuals.manage');
  useEffect(() => { setDrafts({}); setSaved(false); }, [year, month]);

  const key = (e: ActualEntryDto) => `${e.costCenterId}:${e.accountId}`;
  const manualOf = (e: ActualEntryDto) => (drafts[key(e)] !== undefined ? parseAmount(drafts[key(e)]) ?? e.amount : e.amount);
  const invalid = Object.values(drafts).some((v) => parseAmount(v) === null);
  const dirty = Object.keys(drafts).length;

  const guard = (fn: () => void) => { if (!dirty || window.confirm(L.confirmLeave)) fn(); };

  const save = async () => {
    if (!data) return;
    setBusy(true); setSaveError(null); setSaved(false);
    try {
      const entries = data.filter((e) => drafts[key(e)] !== undefined).map((e) => ({ costCenterId: e.costCenterId, accountId: e.accountId, amount: parseAmount(drafts[key(e)]) ?? 0 }));
      await api('PUT', '/actuals', { year, month, entries });
      setDrafts({});
      setSaved(true);
      await reload();
      void months.reload();
    } catch (e) { setSaveError(e); } finally { setBusy(false); }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((e) => !q || `${e.costCenterCode} ${e.costCenterName} ${e.accountCode} ${e.accountName} ${e.sectionName}`.toLowerCase().includes(q));
  }, [data, search]);
  const sum = (f: (e: ActualEntryDto) => number) => rows.reduce((s, e) => s + f(e), 0);
  const totals = { budget: sum((e) => e.budget), manual: sum(manualOf), req: sum((e) => e.fromRequests) };
  const monthTotals = new Map((months.data ?? []).map((m) => [m.month, m.total]));

  return (
    <>
      <PageHeader title={L.title} subtitle={`${L.subtitle} · ${base}`} actions={<>
        {can('excel.export') && <ExportButton path={`/export/actuals${qs({ year })}`} filename={`actuals-${year}.xlsx`} />}
        {editable && can('excel.import') && <Button onClick={() => setImporting(true)}><Icon name="upload" /> {t('common.importExcel')}</Button>}
      </>} />
      <Card>
        <div className="filters">
          <Field label={t('common.year')}>{(id) => (
            <Select id={id} value={year} onChange={(e) => { const v = Number(e.target.value); guard(() => setYear(v)); }} options={years.map((y) => ({ value: y, label: String(y) }))} />
          )}</Field>
          <Field label={t('common.month')}>{(id) => (
            <Select id={id} value={month} onChange={(e) => { const v = Number(e.target.value); guard(() => setMonth(v)); }}
              options={MONTH_NAMES[lang].map((m, i) => ({ value: i + 1, label: monthTotals.has(i + 1) ? fmt(L.monthHasData, { m, v: compact(monthTotals.get(i + 1)!, locale) }) : m }))} />
          )}</Field>
          <Field label={t('common.search')}>{(id) => <Input id={id} type="search" value={search} placeholder={L.searchPh} onChange={(e) => setSearch(e.target.value)} />}</Field>
          <div className="filters-right">
            {dirty > 0 && <span className="dirty">{t('common.unsavedChanges', { n: dirty })}</span>}
            {saved && !dirty && <span className="ok-text"><Icon name="check" /> {t('common.saved')}</span>}
            {editable && dirty > 0 && <Button variant="ghost" onClick={() => setDrafts({})}>{t('common.cancel')}</Button>}
            {editable && <Button variant="primary" busy={busy} disabled={!dirty || invalid} onClick={() => void save()}>{t('common.save')}</Button>}
          </div>
        </div>
        {!editable && <Alert kind="info">{L.readOnly}</Alert>}
        <ErrorMessage error={saveError} />
      </Card>
      <Card flush>
        {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : rows.length === 0 ? <Empty>{L.empty}</Empty> : (
          <>
            <div className="table-toolbar">
              <span className="muted small">{fmt(L.rows, { n: rows.length })} · {MONTH_NAMES[lang][month - 1]} {year}</span>
              <span className="muted small toolbar-right"><Icon name="lock" /> {L.fromRequestsHint}</span>
            </div>
            <div className="table-scroll">
              <table className="table actuals-table">
                <thead><tr>
                  <th>{L.section}</th><th>{t('common.costCenter')}</th><th>{t('common.account')}</th>
                  <th className="r">{L.monthBudget}</th><th className="r">{L.manual}</th><th className="r">{L.fromRequests}</th>
                  <th className="r">{L.totalActual}</th><th className="r">{t('common.variance')}</th>
                </tr></thead>
                <tbody>
                  {rows.map((e) => {
                    const k = key(e);
                    const manual = manualOf(e);
                    const total = manual + e.fromRequests;
                    const isDirty = drafts[k] !== undefined;
                    return (
                      <tr key={k} className={isDirty ? 'is-dirty' : ''}>
                        <td className="muted small">{e.sectionName}</td>
                        <td><b>{e.costCenterCode}</b> <span className="muted small">{e.costCenterName}</span></td>
                        <td><span className="acc-code">{e.accountCode}</span> {e.accountName}</td>
                        <td className="r num">{money(e.budget, locale)}</td>
                        <td className="r num cell">
                          {editable ? (
                            <input className={`cell-input${isDirty && parseAmount(drafts[k]) === null ? ' invalid' : ''}`} inputMode="decimal"
                              value={drafts[k] ?? (e.amount ? String(e.amount) : '')} placeholder="0"
                              onChange={(ev) => { setSaved(false); setDrafts((d) => ({ ...d, [k]: ev.target.value })); }}
                              aria-label={`${L.manual}: ${e.costCenterCode} ${e.accountCode}`} />
                          ) : money(e.amount, locale)}
                        </td>
                        <td className="r num ro-cell">{e.fromRequests ? money(e.fromRequests, locale) : <span className="muted">—</span>}</td>
                        <td className="r num"><b>{money(total, locale)}</b></td>
                        <td className="r num"><Variance value={total - e.budget} /></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <td colSpan={3}><b>{t('common.total')}</b></td>
                  <td className="r num"><b>{money(totals.budget, locale)}</b></td>
                  <td className="r num"><b>{money(totals.manual, locale)}</b></td>
                  <td className="r num"><b>{money(totals.req, locale)}</b></td>
                  <td className="r num"><b>{money(totals.manual + totals.req, locale)}</b></td>
                  <td className="r num"><Variance value={totals.manual + totals.req - totals.budget} /></td>
                </tr></tfoot>
              </table>
            </div>
          </>
        )}
      </Card>
      {importing && (
        <ActualsImportDialog year={year} onClose={() => setImporting(false)} onDone={() => { void reload(); void months.reload(); }} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ import dialog */

const imAz = {
  title: 'Faktiki xərclərin Excel-dən idxalı',
  hint: 'Fayl xərc mərkəzi kodu, hesab kodu və ya ay sütunları (Yan … Dek), ya da "Ay" + "Məbləğ" sütunlarından ibarət olmalıdır. Əvvəlcə fayl yoxlanılır, sonra təsdiqinizlə tətbiq edilir.',
  year: 'İdxal ili',
  file: 'Excel faylı (.xlsx)',
  validate: 'Yoxla',
  apply: 'Tətbiq et',
  template: 'Şablonu yüklə',
  rowsRead: 'Oxunan sətir',
  rowsValid: 'Düzgün sətir',
  total: 'Cəmi məbləğ',
  errors: 'Xətalar',
  warnings: 'Xəbərdarlıqlar',
  row: 'Sətir {n}',
  columns: 'Tanınan sütunlar',
  unmapped: 'tanınmadı',
  okToApply: 'Fayl yoxlanıldı. Tətbiq etdikdə {year} ili üzrə bu fayldakı xərc mərkəzi × hesab × ay xanalarındakı əl ilə daxil edilmiş faktlar əvəzlənəcək.',
  fixErrors: 'Tətbiq etməzdən əvvəl xətaları düzəldin.',
  applied: 'İdxal tamamlandı: {n} sətir tətbiq edildi.',
  more: '… və daha {n}',
};
const IM_TEXT = {
  az: imAz,
  en: {
    title: 'Import actuals from Excel',
    hint: 'The file needs cost center code and account code plus either month columns (Jan … Dec) or "Month" + "Amount" columns. The file is validated first and applied only after you confirm.',
    year: 'Import year',
    file: 'Excel file (.xlsx)',
    validate: 'Validate',
    apply: 'Apply',
    template: 'Download template',
    rowsRead: 'Rows read',
    rowsValid: 'Valid rows',
    total: 'Total amount',
    errors: 'Errors',
    warnings: 'Warnings',
    row: 'Row {n}',
    columns: 'Recognised columns',
    unmapped: 'not recognised',
    okToApply: 'The file is valid. Applying replaces manual actuals for the cost center × account × month cells in this file for {year}.',
    fixErrors: 'Fix the errors before applying.',
    applied: 'Import complete: {n} rows applied.',
    more: '… and {n} more',
  } satisfies typeof imAz,
};

function ActualsImportDialog({ year, onClose, onDone }: { year: number; onClose: () => void; onDone: () => void }) {
  const { t, locale, lang } = useI18n();
  const L = useLocal(IM_TEXT);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<'check' | 'apply' | 'template' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'apply'); setError(null);
    const form = new FormData();
    form.append('year', String(year));
    form.append('dryRun', String(dryRun));
    form.append('file', file);
    try {
      const r = await upload<ImportReport>('/actuals/import', form);
      setReport(r);
      if (!dryRun && r.applied) onDone();
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === 'object' && 'errors' in (e.details as object)) setReport(e.details as ImportReport);
      setError(e);
    } finally { setBusy(null); }
  };

  const issues = (list: { row: number; message: string }[]) => (
    <ul className="error-list">
      {list.slice(0, 50).map((x, i) => <li key={i}><b>{fmt(L.row, { n: x.row })}</b>: {x.message}</li>)}
      {list.length > 50 && <li className="muted">{fmt(L.more, { n: list.length - 50 })}</li>}
    </ul>
  );

  return (
    <Modal wide title={L.title} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{report?.applied ? t('common.close') : t('common.cancel')}</Button>
      {!report?.applied && <Button busy={busy === 'check'} disabled={!file || !!busy} onClick={() => void send(true)}>{L.validate}</Button>}
      {!report?.applied && (
        <Button variant="primary" busy={busy === 'apply'} disabled={!file || !report || !report.dryRun || report.errors.length > 0 || !!busy} onClick={() => void send(false)}>
          {L.apply}
        </Button>
      )}
    </>}>
      <p className="muted">{L.hint}</p>
      <div className="filters import-row">
        <Field label={L.file}>{(id) => (
          <input id={id} ref={fileRef} type="file" className="input" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setError(null); }} />
        )}</Field>
        <Button busy={busy === 'template'} onClick={async () => {
          setBusy('template'); setError(null);
          try { await download(`/export/templates/actuals${qs({ year, lang })}`, `actuals-template-${year}.xlsx`); } catch (e) { setError(e); } finally { setBusy(null); }
        }}><Icon name="download" /> {L.template}</Button>
      </div>
      <p className="small muted">{L.year}: <b>{year}</b></p>
      <ErrorMessage error={error} />
      {report && (
        <div className="import-report">
          <div className="stats">
            <div><small>{L.rowsRead}</small><b>{report.rowsRead}</b></div>
            <div><small>{L.rowsValid}</small><b>{report.rowsValid}</b></div>
            <div><small>{L.total}</small><b className="num">{money(report.total, locale)}</b></div>
            <div><small>{L.errors}</small><b>{report.errors.length}</b></div>
          </div>
          {report.applied ? <Alert kind="success">{fmt(L.applied, { n: report.rowsValid })}</Alert>
            : report.errors.length ? <Alert kind="error">{L.fixErrors}</Alert>
              : <Alert kind="info">{fmt(L.okToApply, { year })}</Alert>}
          {report.columns.length > 0 && (
            <p className="small"><b>{L.columns}:</b> {report.columns.map((c) => `${c.header} → ${c.field ?? L.unmapped}`).join(' · ')}</p>
          )}
          {report.errors.length > 0 && <><div className="h3">{L.errors}</div>{issues(report.errors)}</>}
          {report.warnings.length > 0 && <><div className="h3">{L.warnings}</div>{issues(report.warnings)}</>}
        </div>
      )}
    </Modal>
  );
}
