import { useMemo, useState, type ReactNode } from 'react';
import { EXPORT_HEADERS, MONTH_SHORT, type ImportColumn, type ImportIssue, type ImportReport, type Lang } from '@finbridge/shared';
import { ApiError, download, upload } from '../api/client';
import { fmt, useI18n, useLocal } from '../i18n';
import { money } from '../lib/format';
import { Alert, Badge, Button, ErrorMessage, Field, Icon, Modal, Select, Tabs } from './ui';
import '../styles/budgets.css';

/* ------------------------------------------------------------------ texts */

const az = {
  budgetTitle: 'Büdcənin Excel-dən idxalı',
  actualsTitle: 'Faktiki xərclərin Excel-dən idxalı',
  genericTitle: 'Excel-dən idxal',
  intro: 'Faylı yükləyin, sütunların uyğunluğunu yoxlayın və nəticəyə baxın. Fayl xətasız olana qədər heç nə yazılmır.',
  stepFile: 'Fayl',
  stepMapping: 'Sütunlar',
  stepPreview: 'Yoxlama',
  stepDone: 'İdxal',
  file: 'Excel faylı (.xlsx)',
  fileHint: 'Birinci vərəq oxunur. Başlıq sətri avtomatik tapılır.',
  template: 'Şablonu yüklə',
  mode: 'İdxal rejimi',
  modeReplace: 'Əvəz et — versiyanın bütün sətirləri fayldakılarla əvəzlənir',
  modeAppend: 'Əlavə et — mövcud sətirlər saxlanılır, yeniləri əlavə olunur',
  createMissing: 'Tapılmayan xərc mərkəzi, departament və hesabları yarat',
  createMissingHint: 'Söndürülübsə, naməlum kodlar xəta kimi göstərilir.',
  check: 'Yoxla',
  recheck: 'Yenidən yoxla',
  apply: 'İdxal et',
  close: 'Bağla',
  mappingTitle: 'Sütunların uyğunlaşdırılması',
  mappingHint: 'FinBridge sütunları başlıqlara görə tanıyır. Səhv tanınıbsa və ya tanınmayıbsa, sahəni əl ilə seçin və yenidən yoxlayın.',
  needsMapping: 'Fayldakı başlıqlar tanınmadı. Hər sütun üçün uyğun sahəni seçin və yenidən yoxlayın.',
  colExcel: 'Sütun',
  colHeader: 'Fayldakı başlıq',
  colField: 'FinBridge sahəsi',
  ignore: '— nəzərə alınmasın —',
  auto: 'avtomatik',
  manual: 'əl ilə',
  duplicateField: 'Bu sahə bir neçə sütuna təyin edilib — yalnız birincisi istifadə olunur.',
  requiredMark: 'mütləq',
  staleReport: 'Uyğunlaşdırma və ya parametrlər dəyişib. İdxaldan əvvəl yenidən yoxlayın.',
  rowsRead: 'Oxunan sətir',
  rowsValid: 'Düzgün sətir',
  total: 'Cəmi məbləğ',
  errorsN: 'Xəta',
  warningsN: 'Xəbərdarlıq',
  willCreate: 'İdxal zamanı yaradılacaq',
  units: 'Departamentlər',
  costCenters: 'Xərc mərkəzləri',
  accounts: 'Hesablar',
  issues: 'Sətirlər üzrə nəticə',
  allIssues: 'Hamısı ({n})',
  onlyErrors: 'Xətalar ({n})',
  onlyWarnings: 'Xəbərdarlıqlar ({n})',
  row: 'Sətir',
  level: 'Səviyyə',
  category: 'Növ',
  message: 'İzah',
  error: 'Xəta',
  warning: 'Xəbərdarlıq',
  fileLevel: 'Fayl',
  shownFirst: 'İlk {n} qeyd göstərilir.',
  ok: 'Fayl xətasızdır: {n} sətir idxala hazırdır.',
  nothingValid: 'Faylda idxal ediləcək düzgün sətir yoxdur.',
  fixErrors: 'Xətaları faylda düzəldin və ya uyğunlaşdırmanı dəyişin. Xəta olduqca heç nə idxal edilmir.',
  done: 'İdxal tamamlandı: {n} sətir yazıldı.',
  job: 'İdxal jurnalı № {id}',
  cat: { duplicate: 'Təkrar', group: 'Qrup hesabı', restricted: 'Məhdudiyyət', unknown: 'Naməlum kod', number: 'Rəqəm deyil', column: 'Sütun', other: 'Digər' },
};
const TEXT = {
  az,
  en: {
    budgetTitle: 'Import budget from Excel',
    actualsTitle: 'Import actuals from Excel',
    genericTitle: 'Import from Excel',
    intro: 'Upload the file, check the column mapping and review the result. Nothing is written until the file is error-free.',
    stepFile: 'File',
    stepMapping: 'Columns',
    stepPreview: 'Validation',
    stepDone: 'Import',
    file: 'Excel file (.xlsx)',
    fileHint: 'The first worksheet is read. The header row is detected automatically.',
    template: 'Download template',
    mode: 'Import mode',
    modeReplace: 'Replace — all lines of the version are replaced by the file',
    modeAppend: 'Append — existing lines are kept, new ones are added',
    createMissing: 'Create missing cost centers, departments and accounts',
    createMissingHint: 'When off, unknown codes are reported as errors.',
    check: 'Check',
    recheck: 'Check again',
    apply: 'Import',
    close: 'Close',
    mappingTitle: 'Column mapping',
    mappingHint: 'FinBridge recognises columns by their headers. If a column was detected wrongly or not at all, pick the field by hand and check again.',
    needsMapping: 'The headers in the file were not recognised. Choose the matching field for each column and check again.',
    colExcel: 'Column',
    colHeader: 'Header in file',
    colField: 'FinBridge field',
    ignore: '— ignore —',
    auto: 'auto',
    manual: 'manual',
    duplicateField: 'This field is mapped to several columns — only the first is used.',
    requiredMark: 'required',
    staleReport: 'The mapping or options changed. Check again before importing.',
    rowsRead: 'Rows read',
    rowsValid: 'Valid rows',
    total: 'Total amount',
    errorsN: 'Errors',
    warningsN: 'Warnings',
    willCreate: 'Will be created on import',
    units: 'Departments',
    costCenters: 'Cost centers',
    accounts: 'Accounts',
    issues: 'Row-by-row result',
    allIssues: 'All ({n})',
    onlyErrors: 'Errors ({n})',
    onlyWarnings: 'Warnings ({n})',
    row: 'Row',
    level: 'Level',
    category: 'Type',
    message: 'Details',
    error: 'Error',
    warning: 'Warning',
    fileLevel: 'File',
    shownFirst: 'Showing the first {n} entries.',
    ok: 'The file is error-free: {n} rows are ready to import.',
    nothingValid: 'The file contains no valid rows to import.',
    fixErrors: 'Fix the errors in the file or change the mapping. Nothing is imported while there are errors.',
    done: 'Import completed: {n} rows written.',
    job: 'Import log #{id}',
    cat: { duplicate: 'Duplicate', group: 'Group account', restricted: 'Restricted', unknown: 'Unknown code', number: 'Not a number', column: 'Column', other: 'Other' },
  } satisfies typeof az,
};

/* ------------------------------------------------------------------ props */

/** A mappable target field. `value` is the field name the server understands ("costCenterCode", "m3", …). */
export interface ImportTarget { value: string; label: string; required?: boolean }

/** An extra form field sent with the upload (e.g. mode, createMissing). */
export interface ImportOption {
  name: string;
  label: string;
  hint?: string;
  type: 'checkbox' | 'select';
  options?: { value: string; label: string }[];
  defaultValue: string;
}

export interface ImportDialogProps {
  /** POST endpoint accepting multipart `file`, `dryRun`, `mapping` (JSON: column index → field) and the option fields. */
  endpoint: string;
  /** GET path of the Excel template (lang is appended). */
  templatePath?: string;
  templateFilename?: string;
  title?: string;
  intro?: ReactNode;
  /** Preset for title, options and targets. */
  kind?: 'budget' | 'actuals';
  /** Fixed form fields sent with every upload (e.g. { year: '2026' }). */
  extra?: Record<string, string>;
  /** User-editable form fields; defaults depend on `kind`. */
  options?: ImportOption[];
  /** Fields the user may map columns to; defaults depend on `kind`. */
  targets?: ImportTarget[];
  currency?: string;
  onClose: () => void;
  onDone: (report: ImportReport) => void;
}

/* ------------------------------------------------------------------ helpers */

function defaultTargets(kind: 'budget' | 'actuals' | undefined, lang: Lang): ImportTarget[] {
  const h = EXPORT_HEADERS[lang];
  const months = MONTH_SHORT[lang].map((m, i) => ({ value: `m${i + 1}`, label: m }));
  if (kind === 'actuals') {
    return [
      { value: 'costCenterCode', label: h.costCenterCode, required: true },
      { value: 'accountCode', label: h.accountCode, required: true },
      { value: 'month', label: h.month },
      { value: 'amount', label: h.amount },
      ...months,
    ];
  }
  return [
    { value: 'departmentCode', label: h.departmentCode },
    { value: 'departmentName', label: h.departmentName },
    { value: 'costCenterCode', label: h.costCenterCode, required: true },
    { value: 'costCenterName', label: h.costCenterName },
    { value: 'accountCode', label: h.accountCode, required: true },
    { value: 'accountName', label: h.accountName },
    { value: 'accountType', label: `${h.accountType} (OPEX/CAPEX)` },
    { value: 'description', label: h.description },
    ...months,
  ];
}

const colLetter = (index: number): string => {
  let s = '';
  let n = index;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

type Category = keyof typeof az.cat;

function categoryOf(message: string): Category {
  if (/duplicate|already has a line/i.test(message)) return 'duplicate';
  if (/group account/i.test(message)) return 'group';
  if (/not allowed on|not open for budgeting|does not belong/i.test(message)) return 'restricted';
  if (/unknown|is new|is empty/i.test(message)) return 'unknown';
  if (/not a number|must be 1/i.test(message)) return 'number';
  if (/missing|column/i.test(message)) return 'column';
  return 'other';
}

/** Server import messages are English; translate the known patterns for Azerbaijani users. */
const AZ_PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^The current budget version is not a draft$/, () => 'Büdcənin cari versiyası qaralama deyil — idxal yalnız qaralamaya mümkündür'],
  [/^Missing column: cost center code$/, () => 'Sütun çatışmır: xərc mərkəzi kodu'],
  [/^Missing column: account code$/, () => 'Sütun çatışmır: hesab kodu'],
  [/^Missing month columns.*$/, () => 'Ay sütunları tapılmadı (Yan … Dek / Jan … Dec)'],
  [/^Use either month columns.*$/, () => 'Ya ay sütunlarından (Yan … Dek), ya da "Ay" + "Məbləğ" sütunlarından istifadə edin'],
  [/^cost center code is empty$/, () => 'xərc mərkəzi kodu boşdur'],
  [/^account code is empty$/, () => 'hesab kodu boşdur'],
  [/^unknown cost center \(empty\)$/, () => 'xərc mərkəzi kodu boşdur'],
  [/^unknown account \(empty\)$/, () => 'hesab kodu boşdur'],
  [/^unknown cost center (.+)$/, (c) => `naməlum xərc mərkəzi ${c}`],
  [/^unknown account (.+)$/, (a) => `naməlum hesab ${a}`],
  [/^cost center (.+) is new — .*$/, (c) => `${c} yeni xərc mərkəzidir — onu yaratmaq üçün departament kodu tələb olunur`],
  [/^cost center (.+) does not belong to (.+)$/, (c, u) => `${c} xərc mərkəzi ${u} vahidinə aid deyil`],
  [/^account (.+) is a group account$/, (a) => `${a} qrup hesabıdır — büdcə yalnız alt hesablara yazılır`],
  [/^account (.+) is not open for budgeting$/, (a) => `${a} hesabı büdcələşdirmə üçün açıq deyil`],
  [/^account (.+) is not allowed on (.+)$/, (a, c) => `${a} hesabı ${c} xərc mərkəzi üçün icazəli deyil`],
  [/^month (\d+): "(.*)" is not a number$/, (m, v) => `${m}-ci ay: "${v}" rəqəm deyil`],
  [/^duplicate of row (\d+) \(same cost center and account\)$/, (r) => `${r}-ci sətirin təkrarıdır (eyni xərc mərkəzi və hesab)`],
  [/^duplicate of row (\d+) for month (\d+) — .*$/, (r, m) => `${m}-ci ay üzrə ${r}-ci sətirin təkrarıdır — məbləğlər toplanır`],
  [/^(.+) \/ (.+) already has a line — .*$/, (c, a) => `${c} / ${a} üçün sətir artıq var — ikinci sətir əlavə olunacaq`],
  [/^month must be 1–12$/, () => 'ay 1–12 arasında olmalıdır'],
  [/^amount is not a number$/, () => 'məbləğ rəqəm deyil'],
];

function translateIssue(message: string, lang: Lang): string {
  if (lang !== 'az') return message;
  return message.split('; ').map((part) => {
    for (const [re, f] of AZ_PATTERNS) {
      const m = re.exec(part);
      if (m) return f(...m.slice(1));
    }
    return part;
  }).join('; ');
}

const issueFilterValues = ['all', 'error', 'warning'] as const;
type IssueFilter = (typeof issueFilterValues)[number];

/* ------------------------------------------------------------------ component */

/**
 * Excel import with column mapping: upload → server dry-run detects columns and validates every row →
 * the user corrects the mapping if needed and re-checks → commit (dryRun=false) with the same mapping.
 */
export function ImportDialog(props: ImportDialogProps) {
  const { endpoint, templatePath, templateFilename, kind, extra, currency = 'AZN', onClose, onDone } = props;
  const { lang, locale } = useI18n();
  const L = useLocal(TEXT);

  const options = useMemo<ImportOption[]>(() => props.options ?? (kind === 'budget' || !kind ? [
    { name: 'mode', label: L.mode, type: 'select', defaultValue: 'replace', options: [{ value: 'replace', label: L.modeReplace }, { value: 'append', label: L.modeAppend }] },
    { name: 'createMissing', label: L.createMissing, hint: L.createMissingHint, type: 'checkbox', defaultValue: 'false' },
  ] : []), [props.options, kind, L]);
  const targets = useMemo(() => props.targets ?? defaultTargets(kind, lang), [props.targets, kind, lang]);
  const title = props.title ?? (kind === 'actuals' ? L.actualsTitle : kind === 'budget' ? L.budgetTitle : L.genericTitle);

  const [file, setFile] = useState<File | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(options.map((o) => [o.name, o.defaultValue])));
  const [columns, setColumns] = useState<ImportColumn[] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [autoMapping, setAutoMapping] = useState<Record<string, string>>({});
  const [needsMapping, setNeedsMapping] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<IssueFilter>('all');

  const resetForFile = (f: File | null) => {
    setFile(f); setColumns(null); setMapping(null); setAutoMapping({}); setReport(null); setNeedsMapping(false); setStale(false); setError(null);
  };

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true); setError(null);
    const form = new FormData();
    form.append('file', file);
    form.append('dryRun', String(dryRun));
    for (const o of options) form.append(o.name, values[o.name] ?? o.defaultValue);
    if (mapping) form.append('mapping', JSON.stringify(mapping));
    Object.entries(extra ?? {}).forEach(([k, v]) => form.append(k, v));
    try {
      const r = await upload<ImportReport>(endpoint, form);
      applyReport(r);
      if (r.applied) onDone(r);
    } catch (e) {
      const details = e instanceof ApiError ? e.details as (Partial<ImportReport> & { needsMapping?: boolean }) | undefined : undefined;
      if (details && Array.isArray(details.columns) && 'errors' in details) {
        applyReport(details as ImportReport);
      } else if (details?.needsMapping && Array.isArray(details.columns)) {
        setNeedsMapping(true);
        setColumns(details.columns);
        setMapping(Object.fromEntries(details.columns.map((c) => [String(c.index), ''])));
        setAutoMapping({});
        setReport(null);
        setStale(false);
      } else {
        setError(e);
      }
    } finally { setBusy(false); }
  };

  const applyReport = (r: ImportReport) => {
    setReport(r);
    setStale(false);
    setNeedsMapping(false);
    if (r.columns.length) {
      setColumns(r.columns);
      const m = Object.fromEntries(r.columns.map((c) => [String(c.index), c.field ?? '']));
      setMapping(m);
      if (!Object.keys(autoMapping).length) setAutoMapping(m);
    }
  };

  const changeMapping = (index: number, field: string) => {
    setMapping((m) => ({ ...(m ?? {}), [String(index)]: field }));
    setStale(true);
  };
  const changeOption = (name: string, v: string) => {
    setValues((s) => ({ ...s, [name]: v }));
    if (report) setStale(true);
  };

  const fieldUse = useMemo(() => {
    const n = new Map<string, number>();
    Object.values(mapping ?? {}).forEach((f) => { if (f) n.set(f, (n.get(f) ?? 0) + 1); });
    return n;
  }, [mapping]);

  const issues: ImportIssue[] = useMemo(() => {
    if (!report) return [];
    return [...report.errors.map((e) => ({ ...e, level: 'error' as const })), ...report.warnings.map((w) => ({ ...w, level: 'warning' as const }))]
      .sort((a, b) => a.row - b.row);
  }, [report]);
  const shown = issues.filter((i) => filter === 'all' || i.level === filter);
  const catCounts = useMemo(() => {
    const m = new Map<Category, number>();
    for (const i of issues) m.set(categoryOf(i.message), (m.get(categoryOf(i.message)) ?? 0) + 1);
    return [...m.entries()];
  }, [issues]);

  const created = report ? report.created : null;
  const createdAny = created && (created.units.length + created.costCenters.length + created.accounts.length) > 0;
  const canApply = !!report && !stale && !report.applied && report.errors.length === 0 && report.rowsValid > 0;
  const step = report?.applied ? 3 : report ? 2 : columns ? 1 : 0;
  const steps = [L.stepFile, L.stepMapping, L.stepPreview, L.stepDone];
  const targetOptions = [{ value: '', label: L.ignore }, ...targets.map((t) => ({ value: t.value, label: t.required ? `${t.label} (${L.requiredMark})` : t.label }))];

  return (
    <Modal wide title={title} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{L.close}</Button>
      {!report?.applied && (
        <Button busy={busy} disabled={!file} onClick={() => send(true)}>
          <Icon name="check" /> {report || columns ? L.recheck : L.check}
        </Button>
      )}
      {!report?.applied && (
        <Button variant="primary" busy={busy} disabled={!canApply} onClick={() => send(false)}>
          <Icon name="upload" /> {L.apply}
        </Button>
      )}
    </>}>
      <ol className="stepper import-steps" aria-label={title}>
        {steps.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''}>
            <span className="step-dot">{i < step ? '✓' : i + 1}</span><span>{s}</span>
          </li>
        ))}
      </ol>
      <p className="muted">{props.intro ?? L.intro}</p>

      <div className="import-file">
        <Field label={L.file} hint={L.fileHint}>
          {(id) => <input id={id} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="input"
            disabled={busy || !!report?.applied} onChange={(e) => resetForFile(e.target.files?.[0] ?? null)} />}
        </Field>
        {templatePath && (
          <Button size="sm" variant="ghost" onClick={() => { download(`${templatePath}${templatePath.includes('?') ? '&' : '?'}lang=${lang}`, templateFilename ?? 'finbridge-template.xlsx').catch(setError); }}>
            <Icon name="download" /> {L.template}
          </Button>
        )}
      </div>

      {options.length > 0 && (
        <div className="grid-2">
          {options.map((o) => o.type === 'select' ? (
            <Field key={o.name} label={o.label} hint={o.hint}>
              {(id) => <Select id={id} value={values[o.name]} disabled={!!report?.applied} options={o.options ?? []} onChange={(e) => changeOption(o.name, e.target.value)} />}
            </Field>
          ) : (
            <div key={o.name} className="field">
              <label className="check">
                <input type="checkbox" checked={values[o.name] === 'true'} disabled={!!report?.applied}
                  onChange={(e) => changeOption(o.name, String(e.target.checked))} />
                {o.label}
              </label>
              {o.hint && <small className="hint">{o.hint}</small>}
            </div>
          ))}
        </div>
      )}

      <ErrorMessage error={error} />
      {error instanceof ApiError && error.code === 'IMPORT_FAILED' && <p className="small muted">{error.message}</p>}

      {columns && mapping && (
        <section className="import-section">
          <h3 className="h3">{L.mappingTitle}</h3>
          {needsMapping ? <Alert kind="warning">{L.needsMapping}</Alert> : <p className="small muted mb-8">{L.mappingHint}</p>}
          <div className="table-scroll import-map">
            <table className="table">
              <thead><tr><th>{L.colExcel}</th><th>{L.colHeader}</th><th>{L.colField}</th></tr></thead>
              <tbody>
                {columns.map((c) => {
                  const v = mapping[String(c.index)] ?? '';
                  const dup = v && (fieldUse.get(v) ?? 0) > 1;
                  const manual = (autoMapping[String(c.index)] ?? '') !== v;
                  return (
                    <tr key={c.index} className={manual ? 'is-dirty' : ''}>
                      <td className="num"><span className="acc-code">{colLetter(c.index)}</span></td>
                      <td>{c.header || <span className="muted">—</span>}</td>
                      <td>
                        <div className="map-cell">
                          <Select aria-label={`${L.colField}: ${c.header || colLetter(c.index)}`} value={v} disabled={!!report?.applied}
                            options={targetOptions} onChange={(e) => changeMapping(c.index, e.target.value)} />
                          {v && <Badge tone={manual ? 'warning' : 'muted'}>{manual ? L.manual : L.auto}</Badge>}
                        </div>
                        {dup && <small className="field-error">{L.duplicateField}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {stale && <Alert kind="warning">{L.staleReport}</Alert>}

      {report && (
        <section className={`import-section import-report${stale ? ' is-stale' : ''}`}>
          <div className="stats import-stats">
            <div><small>{L.rowsRead}</small><b className="num">{report.rowsRead}</b></div>
            <div><small>{L.rowsValid}</small><b className="num">{report.rowsValid}</b></div>
            <div><small>{L.total}</small><b className="num">{money(report.total, locale)} {currency}</b></div>
            <div className={report.errors.length ? 'stat-bad' : ''}><small>{L.errorsN}</small><b className="num">{report.errors.length}</b></div>
            <div className={report.warnings.length ? 'stat-warn' : ''}><small>{L.warningsN}</small><b className="num">{report.warnings.length}</b></div>
          </div>

          {report.applied ? <Alert kind="success">{fmt(L.done, { n: report.rowsValid })}{report.jobId ? ` · ${fmt(L.job, { id: report.jobId })}` : ''}</Alert>
            : report.errors.length > 0 ? <Alert kind="error">{L.fixErrors}</Alert>
              : report.rowsValid === 0 ? <Alert kind="warning">{L.nothingValid}</Alert>
                : <Alert kind="success">{fmt(L.ok, { n: report.rowsValid })}</Alert>}

          {createdAny && created && (
            <Alert kind="info">
              <b>{L.willCreate}:</b>
              {created.units.length > 0 && <div>{L.units}: {created.units.join(', ')}</div>}
              {created.costCenters.length > 0 && <div>{L.costCenters}: {created.costCenters.join(', ')}</div>}
              {created.accounts.length > 0 && <div>{L.accounts}: {created.accounts.join(', ')}</div>}
            </Alert>
          )}

          {issues.length > 0 && (
            <>
              <h3 className="h3">{L.issues}</h3>
              <div className="issue-cats">
                {catCounts.map(([c, n]) => <Badge key={c} tone="neutral">{L.cat[c]}: {n}</Badge>)}
              </div>
              <Tabs<IssueFilter> value={filter} onChange={setFilter} tabs={[
                { value: 'all', label: fmt(L.allIssues, { n: issues.length }) },
                { value: 'error', label: fmt(L.onlyErrors, { n: report.errors.length }) },
                { value: 'warning', label: fmt(L.onlyWarnings, { n: report.warnings.length }) },
              ]} />
              <div className="table-scroll import-issues">
                <table className="table">
                  <thead><tr><th className="r">{L.row}</th><th>{L.level}</th><th>{L.category}</th><th>{L.message}</th></tr></thead>
                  <tbody>
                    {shown.slice(0, 300).map((i, k) => (
                      <tr key={k}>
                        <td className="r num">{i.row > 0 ? i.row : <span className="muted">{L.fileLevel}</span>}</td>
                        <td>{i.level === 'warning' ? <Badge tone="warning">! {L.warning}</Badge> : <Badge tone="danger">✕ {L.error}</Badge>}</td>
                        <td className="small">{L.cat[categoryOf(i.message)]}</td>
                        <td>{translateIssue(i.message, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shown.length > 300 && <p className="small muted">{fmt(L.shownFirst, { n: 300 })}</p>}
            </>
          )}
        </section>
      )}
    </Modal>
  );
}
