import { useState } from 'react';
import type { BulkImportKindDto, BulkImportReport, BulkRowAction } from '@finbridge/shared';
import { api, download, upload } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { fmt, useI18n, useLocal } from '../i18n';
import { Alert, Badge, Button, ErrorMessage, Field, Icon, Input, Modal, Tabs } from './ui';
import '../styles/bulk-import.css';

const az = {
  title: 'Toplu idxal: {name}',
  intro: 'Şablonu yükləyin, doldurun və faylı seçin. Əvvəlcə "Yoxla" basın — fayl xətasız olana qədər heç nə yazılmır.',
  step1: '1. Şablon',
  emptyTemplate: 'Boş şablon',
  currentTemplate: 'Mövcud məlumatla ({n})',
  templateHint: '"Mövcud məlumatla" şablonu cari qeydləri ehtiva edir: dəyişdirib geri yükləyə bilərsiniz.',
  step2: '2. Fayl və parametrlər',
  file: 'Excel faylı (.xlsx)',
  mode: 'Mövcud qeydlər',
  modeUpsert: 'Yenilə — {match} üzrə tapılan qeydlər yenilənir, yeniləri yaradılır',
  modeCreate: 'Toxunma — yalnız yeni qeydlər yaradılır, mövcudlar ötürülür',
  password: 'Yeni istifadəçilər üçün ilkin şifrə',
  passwordHint: 'Ən azı 8 simvol. Şifrə faylda saxlanılmır; istifadəçiyə ayrıca bildirin və ilk girişdən sonra dəyişməsini xahiş edin.',
  check: 'Yoxla',
  recheck: 'Yenidən yoxla',
  apply: 'İdxal et',
  close: 'Bağla',
  step3: '3. Nəticə',
  rowsRead: 'Sətir',
  created: 'Yaradılacaq',
  updated: 'Yenilənəcək',
  unchanged: 'Dəyişməz',
  skipped: 'Ötürülür',
  createdDone: 'Yaradıldı',
  updatedDone: 'Yeniləndi',
  errors: 'Xəta',
  warnings: 'Xəbərdarlıq',
  ok: 'Fayl xətasızdır. "İdxal et" basın.',
  nothing: 'Dəyişiklik yoxdur: fayldakı bütün qeydlər artıq eynidir.',
  fix: 'Xətaları faylda düzəldin və yenidən yükləyin. Xəta olduqca heç bir sətir yazılmır.',
  done: 'İdxal tamamlandı. Jurnal № {id}.',
  tabIssues: 'Xəta və xəbərdarlıqlar ({n})',
  tabRows: 'Sətirlər ({n})',
  row: 'Sətir',
  file0: 'Fayl',
  key: 'Açar',
  action: 'Nəticə',
  changes: 'Dəyişən sahələr',
  message: 'İzah',
  stale: 'Fayl və ya parametrlər dəyişib — yenidən yoxlayın.',
  shown: 'İlk {n} sətir göstərilir.',
  actions: { CREATE: 'Yeni', UPDATE: 'Yenilənir', UNCHANGED: 'Dəyişməz', SKIP: 'Ötürülür', ERROR: 'Xəta' },
};
const TEXT = {
  az,
  en: {
    title: 'Bulk import: {name}',
    intro: 'Download the template, fill it in and choose the file. Press "Check" first — nothing is written until the file has no errors.',
    step1: '1. Template',
    emptyTemplate: 'Empty template',
    currentTemplate: 'With current data ({n})',
    templateHint: 'The "with current data" template contains the existing records: edit them and upload the file back.',
    step2: '2. File and options',
    file: 'Excel file (.xlsx)',
    mode: 'Existing records',
    modeUpsert: 'Update — records found by {match} are updated, new ones are created',
    modeCreate: 'Leave as is — only new records are created, existing ones are skipped',
    password: 'Initial password for new users',
    passwordHint: 'At least 8 characters. The password is not stored in the file; tell users separately and ask them to change it after the first sign-in.',
    check: 'Check',
    recheck: 'Check again',
    apply: 'Import',
    close: 'Close',
    step3: '3. Result',
    rowsRead: 'Rows',
    created: 'To create',
    updated: 'To update',
    unchanged: 'Unchanged',
    skipped: 'Skipped',
    createdDone: 'Created',
    updatedDone: 'Updated',
    errors: 'Errors',
    warnings: 'Warnings',
    ok: 'The file has no errors. Press "Import".',
    nothing: 'Nothing to change: every record in the file is already the same.',
    fix: 'Fix the errors in the file and upload it again. While there are errors no row is written.',
    done: 'Import completed. Log no. {id}.',
    tabIssues: 'Errors and warnings ({n})',
    tabRows: 'Rows ({n})',
    row: 'Row',
    file0: 'File',
    key: 'Key',
    action: 'Result',
    changes: 'Changed fields',
    message: 'Message',
    stale: 'The file or options changed — check again.',
    shown: 'First {n} rows shown.',
    actions: { CREATE: 'New', UPDATE: 'Updated', UNCHANGED: 'Unchanged', SKIP: 'Skipped', ERROR: 'Error' },
  } satisfies typeof az,
};

const ACTION_TONE: Record<BulkRowAction, string> = { CREATE: 'success', UPDATE: 'info', UNCHANGED: 'muted', SKIP: 'neutral', ERROR: 'danger' };

/** Template download + check + import for one master-data entity (see server/src/services/bulkImport). */
export function BulkImportDialog({ kind, onClose, onDone }: { kind: BulkImportKindDto; onClose: () => void; onDone?: () => void }) {
  const L = useLocal(TEXT);
  const { lang } = useI18n();
  const { can } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'upsert' | 'create'>('upsert');
  const [password, setPassword] = useState('');
  const [report, setReport] = useState<BulkImportReport | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<'check' | 'apply' | 'tpl' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<'issues' | 'rows'>('issues');

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'apply'); setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('dryRun', String(dryRun));
      form.append('mode', mode);
      if (kind.needsPassword && password) form.append('initialPassword', password);
      const r = await upload<BulkImportReport>(`/bulk-import/${kind.kind}?lang=${lang}`, form);
      setReport(r);
      setStale(false);
      setTab(r.errors.length || r.warnings.length ? 'issues' : 'rows');
      if (r.applied) onDone?.();
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const tpl = async (prefill: boolean) => {
    setBusy('tpl'); setError(null);
    try { await download(`/bulk-import/${kind.kind}/template?lang=${lang}${prefill ? '&prefill=1' : ''}`, `${kind.kind.toLowerCase()}.xlsx`); }
    catch (e) { setError(e); } finally { setBusy(null); }
  };
  const changed = () => { if (report) setStale(true); };
  const passwordInvalid = kind.needsPassword && password !== '' && password.length < 8;
  const applied = report?.applied;
  const canApply = !!report && report.dryRun && !stale && !report.errors.length && report.created + report.updated > 0 && !passwordInvalid;
  const issues = report ? [...report.errors, ...report.warnings].sort((a, b) => a.row - b.row) : [];

  return (
    <Modal wide title={fmt(L.title, { name: kind.title })} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{L.close}</Button>
      {!applied && <Button busy={busy === 'check'} disabled={!file || passwordInvalid} onClick={() => send(true)}>{report ? L.recheck : L.check}</Button>}
      {!applied && can('excel.import') && <Button variant="primary" busy={busy === 'apply'} disabled={!canApply} onClick={() => send(false)}><Icon name="upload" /> {L.apply}</Button>}
    </>}>
      <p className="muted">{L.intro}</p>
      <p className="small">{kind.description}</p>

      <h3 className="bi-step">{L.step1}</h3>
      <div className="bi-row">
        <Button size="sm" busy={busy === 'tpl'} onClick={() => tpl(false)}><Icon name="download" /> {L.emptyTemplate}</Button>
        <Button size="sm" disabled={!kind.existing} onClick={() => tpl(true)}><Icon name="download" /> {fmt(L.currentTemplate, { n: kind.existing })}</Button>
      </div>
      <p className="hint">{L.templateHint}</p>

      <h3 className="bi-step">{L.step2}</h3>
      <div className="grid-2">
        <Field label={L.file}>
          {(id) => <input id={id} type="file" className="input" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setStale(false); }} disabled={!!applied} />}
        </Field>
        {kind.needsPassword && (
          <Field label={L.password} hint={L.passwordHint} error={passwordInvalid ? L.passwordHint : undefined}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); changed(); }} disabled={!!applied} />}
          </Field>
        )}
      </div>
      <fieldset className="bi-mode" disabled={!!applied}>
        <legend>{L.mode}</legend>
        <label><input type="radio" name="bi-mode" checked={mode === 'upsert'} onChange={() => { setMode('upsert'); changed(); }} /> {fmt(L.modeUpsert, { match: kind.matchBy })}</label>
        <label><input type="radio" name="bi-mode" checked={mode === 'create'} onChange={() => { setMode('create'); changed(); }} /> {L.modeCreate}</label>
      </fieldset>
      <ErrorMessage error={error} />

      {report && (
        <>
          <h3 className="bi-step">{L.step3}</h3>
          {stale && <Alert kind="warning">{L.stale}</Alert>}
          <div className="bi-stats">
            <Stat label={L.rowsRead} value={report.rowsRead} />
            <Stat label={applied ? L.createdDone : L.created} value={report.created} tone="success" />
            <Stat label={applied ? L.updatedDone : L.updated} value={report.updated} tone="info" />
            <Stat label={L.unchanged} value={report.unchanged} />
            {report.skipped > 0 && <Stat label={L.skipped} value={report.skipped} />}
            <Stat label={L.errors} value={report.errors.length} tone={report.errors.length ? 'danger' : undefined} />
            <Stat label={L.warnings} value={report.warnings.length} tone={report.warnings.length ? 'warning' : undefined} />
          </div>
          {applied ? <Alert kind="success"><Icon name="check" /> {fmt(L.done, { id: report.jobId ?? '—' })}</Alert>
            : report.errors.length ? <Alert kind="error">{L.fix}</Alert>
              : report.created + report.updated === 0 ? <Alert kind="info">{L.nothing}</Alert>
                : <Alert kind="success">{L.ok}</Alert>}
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'issues', label: fmt(L.tabIssues, { n: issues.length }) },
            { value: 'rows', label: fmt(L.tabRows, { n: report.rows.length }) },
          ]} />
          {tab === 'issues' ? (
            issues.length ? (
              <div className="table-scroll bi-table">
                <table className="table">
                  <thead><tr><th className="num">{L.row}</th><th>{L.action}</th><th>{L.message}</th></tr></thead>
                  <tbody>
                    {issues.map((i, n) => (
                      <tr key={n}>
                        <td className="num">{i.row || L.file0}</td>
                        <td>{i.level === 'warning' ? <Badge tone="warning">{L.warnings}</Badge> : <Badge tone="danger">{L.errors}</Badge>}</td>
                        <td>{i.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted">—</p>
          ) : (
            <div className="table-scroll bi-table">
              <table className="table">
                <thead><tr><th className="num">{L.row}</th><th>{L.key}</th><th>{L.action}</th><th>{L.changes}</th></tr></thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={`${r.row}-${r.key}`}>
                      <td className="num">{r.row}</td>
                      <td><code>{r.key}</code></td>
                      <td><Badge tone={ACTION_TONE[r.action]}>{L.actions[r.action]}</Badge></td>
                      <td className="small">{r.changes.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.rows.length >= 1000 && <p className="hint">{fmt(L.shown, { n: 1000 })}</p>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className={`bi-stat${tone ? ` bi-${tone}` : ''}`}><span>{label}</span><b>{value}</b></div>;
}

const btnText = { az: { label: 'Excel-dən toplu idxal' }, en: { label: 'Bulk import from Excel' } };

/** Header button for an admin page: loads the column description lazily and opens the dialog. */
export function BulkImportButton({ kind, onDone }: { kind: BulkImportKindDto['kind']; onDone?: () => void }) {
  const L = useLocal(btnText);
  const { lang } = useI18n();
  const { can } = useAuth();
  const [dto, setDto] = useState<BulkImportKindDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!can('excel.import')) return null;
  const open = async () => {
    setBusy(true); setError(null);
    try {
      const kinds = await api<BulkImportKindDto[]>('GET', `/bulk-import/kinds?lang=${lang}`);
      setDto(kinds.find((k) => k.kind === kind) ?? null);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <>
      <Button busy={busy} onClick={open}><Icon name="upload" /> {L.label}</Button>
      {error ? <ErrorMessage error={error} /> : null}
      {dto && <BulkImportDialog kind={dto} onClose={() => setDto(null)} onDone={onDone} />}
    </>
  );
}
