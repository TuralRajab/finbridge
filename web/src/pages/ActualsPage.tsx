import { useEffect, useState } from 'react';
import { MONTH_NAMES, type ActualEntryDto } from '@finbridge/shared';
import { api, qs } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ImportDialog } from '../components/ImportDialog';
import { Alert, Button, Card, Empty, ErrorMessage, ExportButton, Field, Icon, PageHeader, Select, Spinner, Variance } from '../components/ui';
import { useI18n } from '../i18n';
import { money, parseAmount } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useYear } from './useYear';

export function ActualsPage() {
  const { t, locale, lang } = useI18n();
  const { can } = useAuth();
  const { year, setYear, years } = useYear();
  const [month, setMonth] = useState(() => Math.max(1, new Date().getMonth()));
  const { data, loading, error, reload } = useAsync(() => api<ActualEntryDto[]>('GET', `/actuals${qs({ year, month })}`), [year, month]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [importing, setImporting] = useState(false);
  const [saved, setSaved] = useState(false);
  const editable = can('actuals.manage');
  useEffect(() => { setDrafts({}); setSaved(false); }, [year, month]);

  const key = (e: ActualEntryDto) => `${e.costCenterId}:${e.accountId}`;
  const amountOf = (e: ActualEntryDto) => (drafts[key(e)] !== undefined ? parseAmount(drafts[key(e)]) ?? e.amount : e.amount);
  const invalid = Object.values(drafts).some((v) => parseAmount(v) === null);

  const save = async () => {
    if (!data) return;
    setBusy(true); setSaveError(null); setSaved(false);
    try {
      const entries = data.filter((e) => drafts[key(e)] !== undefined).map((e) => ({ costCenterId: e.costCenterId, accountId: e.accountId, amount: parseAmount(drafts[key(e)]) ?? 0 }));
      await api('PUT', '/actuals', { year, month, entries });
      setDrafts({});
      setSaved(true);
      await reload();
    } catch (e) { setSaveError(e); } finally { setBusy(false); }
  };

  const rows = data ?? [];
  const totalBudget = rows.reduce((s, e) => s + e.budget, 0);
  const totalActual = rows.reduce((s, e) => s + amountOf(e), 0);
  const dirty = Object.keys(drafts).length;

  return (
    <>
      <PageHeader title={t('actuals.title')} subtitle={`${t('actuals.subtitle')} · AZN`} actions={<>
        <ExportButton path={`/export/actuals${qs({ year })}`} filename={`actuals-${year}.xlsx`} />
        {editable && can('excel.import') && <Button onClick={() => setImporting(true)}><Icon name="upload" /> {t('common.importExcel')}</Button>}
      </>} />
      <Card>
        <div className="filters">
          <Field label={t('common.year')}>{(id) => <Select id={id} value={year} onChange={(e) => setYear(Number(e.target.value))} options={years.map((y) => ({ value: y, label: String(y) }))} />}</Field>
          <Field label={t('common.month')}>{(id) => <Select id={id} value={month} onChange={(e) => setMonth(Number(e.target.value))} options={MONTH_NAMES[lang].map((m, i) => ({ value: i + 1, label: m }))} />}</Field>
          <div className="filters-right">
            {dirty > 0 && <span className="dirty">{t('common.unsavedChanges', { n: dirty })}</span>}
            {saved && <span className="ok-text"><Icon name="check" /> {t('common.saved')}</span>}
            {editable && <Button variant="primary" busy={busy} disabled={!dirty || invalid} onClick={save}>{t('common.save')}</Button>}
          </div>
        </div>
        {!editable && <Alert kind="info">{t('actuals.readOnly')}</Alert>}
        <ErrorMessage error={saveError} />
      </Card>
      <Card flush>
        {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : rows.length === 0 ? <Empty>{t('actuals.empty')}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{t('lines.department')}</th><th>{t('lines.costCenter')}</th><th>{t('lines.account')}</th>
                <th className="r">{t('actuals.budget')}</th><th className="r">{t('actuals.actual')}</th><th className="r">{t('actuals.variance')}</th>
              </tr></thead>
              <tbody>
                {rows.map((e) => {
                  const k = key(e);
                  const amount = amountOf(e);
                  return (
                    <tr key={k} className={drafts[k] !== undefined ? 'is-dirty' : ''}>
                      <td className="muted">{e.departmentName}</td>
                      <td><b>{e.costCenterCode}</b> <span className="muted small">{e.costCenterName}</span></td>
                      <td><span className="acc-code">{e.accountCode}</span> {e.accountName}</td>
                      <td className="r num">{money(e.budget, locale)}</td>
                      <td className="r num cell">
                        {editable ? (
                          <input className={`cell-input${drafts[k] !== undefined && parseAmount(drafts[k]) === null ? ' invalid' : ''}`} inputMode="decimal"
                            value={drafts[k] ?? String(e.amount)} onChange={(ev) => setDrafts((d) => ({ ...d, [k]: ev.target.value }))} aria-label={`${e.costCenterCode} ${e.accountCode}`} />
                        ) : money(e.amount, locale)}
                      </td>
                      <td className="r num"><Variance value={amount - e.budget} /></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr>
                <td colSpan={3}><b>{t('common.total')}</b></td>
                <td className="r num"><b>{money(totalBudget, locale)}</b></td>
                <td className="r num"><b>{money(totalActual, locale)}</b></td>
                <td className="r num"><Variance value={totalActual - totalBudget} /></td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </Card>
      {importing && (
        <ImportDialog kind="actuals" endpoint="/actuals/import" templatePath="/export/templates/actuals" extra={{ year: String(year) }}
          onClose={() => setImporting(false)} onDone={() => void reload()} />
      )}
    </>
  );
}
