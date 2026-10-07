import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BulkImportKindDto } from '@finbridge/shared';
import { api, download } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { BulkImportDialog } from '../../components/BulkImportDialog';
import { Alert, Badge, Button, Card, ErrorMessage, Icon, PageHeader, Spinner } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { useAsync } from '../../lib/useAsync';
import '../../styles/bulk-import.css';

const az = {
  title: 'Toplu idxal',
  subtitle: 'Hər bölmə üçün Excel şablonu: boş və ya mövcud məlumatla. Doldurun, yoxlayın, idxal edin.',
  order: 'Tövsiyə olunan ardıcıllıq: əvvəlcə struktur və istifadəçilər, sonra hesablar və xərc mərkəzləri, sonda büdcə və fakt. Hər fayl təkrar yüklənə bilər — mövcud qeydlər yenilənir, dublikat yaranmır.',
  rules: 'Qaydalar: boş xana cari dəyəri saxlayır; "-" istəyə bağlı dəyəri silir; * ilə işarələnmiş sütunlar mütləqdir; başlıqlar Azərbaycan və ya ingilis dilində ola bilər.',
  existing: '{n} qeyd',
  matchBy: 'Uyğunlaşdırma: {m}',
  empty: 'Boş şablon',
  current: 'Mövcud məlumatla',
  import: 'İdxal et',
  columns: 'Sütunlar ({n})',
  colHeader: 'Sütun',
  colRequired: 'Mütləq',
  colFormat: 'Format / dəyərlər',
  colHint: 'İzah',
  colExample: 'Nümunə',
  yes: 'Bəli',
  no: 'Xeyr',
  forNew: 'Yeni qeyd üçün',
  types: { text: 'Mətn', code: 'Kod', email: 'E-poçt', number: 'Rəqəm', date: 'Tarix', bool: 'Bəli / Xeyr', enum: 'Siyahıdan', list: 'Kodlar, vergüllə' },
  noImport: 'Faylları yükləmək üçün "Excel idxal" icazəsi lazımdır. Şablonları yükləyə bilərsiniz.',
  budget: 'Büdcə sətirləri',
  budgetDesc: 'Xərc mərkəzi × hesab × 12 ay. Büdcə qaralama versiyasına idxal olunur: Büdcələr → büdcəni açın → "Excel-dən idxal" (sütunların uyğunlaşdırılması ilə).',
  actuals: 'Faktiki xərclər',
  actualsDesc: 'Ay üzrə fakt (məs. 1C-dən çıxarış). Faktiki xərclər səhifəsində "Excel-dən idxal".',
  openBudgets: 'Büdcələrə keç',
  openActuals: 'Faktiki xərclərə keç',
  history: 'İdxal tarixçəsi',
  historyHint: 'Bütün idxallar (yoxlama, uğurlu və uğursuz) Audit jurnalında saxlanılır.',
};
const TEXT = {
  az,
  en: {
    title: 'Bulk import',
    subtitle: 'An Excel template for every section: empty or with the current data. Fill in, check, import.',
    order: 'Recommended order: structure and users first, then accounts and cost centers, budgets and actuals last. Every file can be uploaded again — existing records are updated, no duplicates are created.',
    rules: 'Rules: an empty cell keeps the current value; "-" clears an optional value; columns marked * are required; headers may be in Azerbaijani or English.',
    existing: '{n} records',
    matchBy: 'Matched by: {m}',
    empty: 'Empty template',
    current: 'With current data',
    import: 'Import',
    columns: 'Columns ({n})',
    colHeader: 'Column',
    colRequired: 'Required',
    colFormat: 'Format / values',
    colHint: 'Description',
    colExample: 'Example',
    yes: 'Yes',
    no: 'No',
    forNew: 'For new records',
    types: { text: 'Text', code: 'Code', email: 'E-mail', number: 'Number', date: 'Date', bool: 'Yes / No', enum: 'From list', list: 'Codes, comma-separated' },
    noImport: 'Uploading files needs the "Excel import" permission. You can download the templates.',
    budget: 'Budget lines',
    budgetDesc: 'Cost center × account × 12 months. Imported into a draft budget version: Budgets → open the budget → "Import from Excel" (with column mapping).',
    actuals: 'Actuals',
    actualsDesc: 'Monthly actuals (e.g. an export from 1C). "Import from Excel" on the Actuals page.',
    openBudgets: 'Go to budgets',
    openActuals: 'Go to actuals',
    history: 'Import history',
    historyHint: 'Every import (checks, successful and failed) is kept in the Audit log.',
  } satisfies typeof az,
};

export function BulkImportPage() {
  const L = useLocal(TEXT);
  const { lang } = useI18n();
  const { can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api<BulkImportKindDto[]>('GET', `/bulk-import/kinds?lang=${lang}`), [lang]);
  const [open, setOpen] = useState<BulkImportKindDto | null>(null);
  const [dlError, setDlError] = useState<unknown>(null);
  const tpl = async (k: BulkImportKindDto, prefill: boolean) => {
    setDlError(null);
    try { await download(`/bulk-import/${k.kind}/template?lang=${lang}${prefill ? '&prefill=1' : ''}`, `${k.kind.toLowerCase()}.xlsx`); } catch (e) { setDlError(e); }
  };
  const fixed = async (path: string, name: string) => {
    setDlError(null);
    try { await download(`${path}?lang=${lang}`, name); } catch (e) { setDlError(e); }
  };

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} actions={can('excel.import') && <Link className="btn btn-secondary" to="/admin/audit?tab=imports"><Icon name="history" /> {L.history}</Link>} />
      <Alert kind="info">{L.order}<br />{L.rules}</Alert>
      {!can('excel.import') && <Alert kind="warning">{L.noImport}</Alert>}
      <ErrorMessage error={error ?? dlError} />
      {loading && !data ? <Spinner /> : (
        <div className="bi-hub">
          {(data ?? []).map((k, i) => (
            <Card key={k.kind}>
              <div className="bi-card-head">
                <div className="bi-title">
                  <span className="bi-num">{i + 1}</span>
                  <div>
                    <h2>{k.title} <Badge tone="neutral">{fmt(L.existing, { n: k.existing })}</Badge></h2>
                    <p className="muted small">{k.description}</p>
                    <p className="hint">{fmt(L.matchBy, { m: k.matchBy })}</p>
                  </div>
                </div>
                <div className="bi-actions">
                  <Button size="sm" onClick={() => tpl(k, false)}><Icon name="download" /> {L.empty}</Button>
                  <Button size="sm" disabled={!k.existing} onClick={() => tpl(k, true)}><Icon name="download" /> {L.current}</Button>
                  {k.canImport && <Button size="sm" variant="primary" onClick={() => setOpen(k)}><Icon name="upload" /> {L.import}</Button>}
                </div>
              </div>
              <details className="bi-cols">
                <summary>{fmt(L.columns, { n: k.columns.length })}</summary>
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>{L.colHeader}</th><th>{L.colRequired}</th><th>{L.colFormat}</th><th>{L.colHint}</th><th>{L.colExample}</th></tr></thead>
                    <tbody>
                      {k.columns.map((c) => (
                        <tr key={c.key}>
                          <td><b>{c.header}</b></td>
                          <td>{c.required === true ? <Badge tone="info">{L.yes}</Badge> : c.required === 'create' ? <span className="small">{L.forNew}</span> : <span className="muted small">{L.no}</span>}</td>
                          <td>{L.types[c.type]}{c.type === 'enum' && c.options.length > 0 && <div className="bi-opts">{c.options.join(', ')}</div>}</td>
                          <td className="small">{c.hint}</td>
                          <td className="small"><code>{c.example}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </Card>
          ))}
          {can('budget.view') && (
            <Card>
              <div className="bi-card-head">
                <div className="bi-title">
                  <span className="bi-num">{(data?.length ?? 0) + 1}</span>
                  <div><h2>{L.budget}</h2><p className="muted small">{L.budgetDesc}</p></div>
                </div>
                <div className="bi-actions">
                  {can('excel.import') && <Button size="sm" onClick={() => fixed('/export/templates/budget', 'budget-template.xlsx')}><Icon name="download" /> {L.empty}</Button>}
                  <Link className="btn btn-sm btn-secondary" to="/budgets">{L.openBudgets}</Link>
                </div>
              </div>
            </Card>
          )}
          {can('actuals.view') && (
            <Card>
              <div className="bi-card-head">
                <div className="bi-title">
                  <span className="bi-num">{(data?.length ?? 0) + 2}</span>
                  <div><h2>{L.actuals}</h2><p className="muted small">{L.actualsDesc}</p></div>
                </div>
                <div className="bi-actions">
                  {can('excel.import') && <Button size="sm" onClick={() => fixed('/export/templates/actuals', 'actuals-template.xlsx')}><Icon name="download" /> {L.empty}</Button>}
                  <Link className="btn btn-sm btn-secondary" to="/actuals">{L.openActuals}</Link>
                </div>
              </div>
            </Card>
          )}
          <p className="hint">{L.historyHint}</p>
        </div>
      )}
      {open && <BulkImportDialog kind={open} onClose={() => setOpen(null)} onDone={reload} />}
    </>
  );
}
