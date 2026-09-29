import { useState } from 'react';
import type { ImportReport } from '@finbridge/shared';
import { download, upload } from '../api/client';
import { useI18n } from '../i18n';
import { money } from '../lib/format';
import { Alert, Button, ErrorMessage, Field, Icon, Modal } from './ui';

/**
 * Two-step Excel import: "Check" runs a dry-run on the server and shows what will happen,
 * "Import" applies it. Nothing is written until the file is error-free.
 */
export function ImportDialog({ kind, endpoint, templatePath, extra, onClose, onDone }: {
  kind: 'budget' | 'actuals';
  endpoint: string;
  templatePath: string;
  extra?: Record<string, string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale, lang } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [createMissing, setCreateMissing] = useState(true);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true); setError(null);
    const form = new FormData();
    form.append('file', file);
    form.append('dryRun', String(dryRun));
    if (kind === 'budget') { form.append('mode', mode); form.append('createMissing', String(createMissing)); }
    Object.entries(extra ?? {}).forEach(([k, v]) => form.append(k, v));
    try {
      const r = await upload<ImportReport>(endpoint, form);
      setReport(r);
      if (r.applied) onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const created = report ? [...report.created.departments, ...report.created.costCenters, ...report.created.accounts] : [];
  return (
    <Modal wide title={t(kind === 'budget' ? 'import.budgetTitle' : 'import.actualsTitle')} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      {!report?.applied && <Button busy={busy} disabled={!file} onClick={() => send(true)}>{t('import.check')}</Button>}
      {!report?.applied && <Button variant="primary" busy={busy} disabled={!file || !report || report.errors.length > 0 || report.rowsValid === 0} onClick={() => send(false)}>{t('import.apply')}</Button>}
    </>}>
      <p className="muted">{t(kind === 'budget' ? 'import.intro' : 'import.actualsIntro')}</p>
      <div className="row gap">
        <Button size="sm" variant="ghost" onClick={() => download(`${templatePath}?lang=${lang}`, 'template.xlsx')}>
          <Icon name="download" /> {t('common.downloadTemplate')}
        </Button>
      </div>
      <Field label={t('import.file')}>
        {(id) => <input id={id} type="file" accept=".xlsx" className="input" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />}
      </Field>
      {kind === 'budget' && (
        <div className="grid-2">
          <Field label={t('import.mode')}>
            {(id) => (
              <select id={id} className="input select" value={mode} onChange={(e) => { setMode(e.target.value as 'replace' | 'append'); setReport(null); }}>
                <option value="replace">{t('import.modeReplace')}</option>
                <option value="append">{t('import.modeAppend')}</option>
              </select>
            )}
          </Field>
          <label className="check">
            <input type="checkbox" checked={createMissing} onChange={(e) => { setCreateMissing(e.target.checked); setReport(null); }} />
            {t('import.createMissing')}
          </label>
        </div>
      )}
      <ErrorMessage error={error} />
      {report && (
        <div className="import-report">
          <div className="stats">
            <div><small>{t('import.rowsRead')}</small><b>{report.rowsRead}</b></div>
            <div><small>{t('import.rowsValid')}</small><b>{report.rowsValid}</b></div>
            <div><small>{t('import.total')}</small><b>{money(report.total, locale)} AZN</b></div>
          </div>
          {created.length > 0 && <Alert kind="info"><b>{t('import.willCreate')}:</b> {created.join(', ')}</Alert>}
          {report.errors.length > 0 ? (
            <div className="alert alert-error">
              <b>{t('import.errors')} ({report.errors.length})</b>
              <ul className="error-list">
                {report.errors.slice(0, 50).map((e, i) => <li key={i}>{t('import.row', { n: e.row })}: {e.message}</li>)}
              </ul>
            </div>
          ) : (
            <Alert kind="success">{report.applied ? t('import.done') : t('import.ok')}</Alert>
          )}
        </div>
      )}
    </Modal>
  );
}
