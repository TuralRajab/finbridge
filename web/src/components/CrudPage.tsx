import { useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { useAsync } from '../lib/useAsync';
import { Button, Card, Empty, ErrorMessage, ExportButton, Field, Icon, Input, Modal, PageHeader, Select, Spinner } from './ui';

export interface CrudField<F> {
  key: keyof F & string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'select' | 'checkbox';
  options?: { value: string | number; label: string }[];
  required?: boolean;
  hint?: string;
  /** Only shown when creating a record. */
  createOnly?: boolean;
}

export interface CrudColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  align?: 'right';
}

/** Generic list + create/edit modal page used for master data and users. */
export function CrudPage<T extends { id: number }, F extends Record<string, unknown>>({
  title, subtitle, endpoint, exportPath, exportName, columns, fields, toForm, emptyForm, toPayload, canManage, newLabel, banner, canDelete = true, onSaved,
}: {
  title: string; subtitle: string; endpoint: string; exportPath?: string; exportName?: string;
  columns: CrudColumn<T>[]; fields: CrudField<F>[];
  toForm: (row: T) => F; emptyForm: () => F; toPayload: (form: F, isNew: boolean) => unknown;
  canManage: boolean; newLabel: string; banner?: ReactNode; canDelete?: boolean; onSaved?: () => void;
}) {
  const { t } = useI18n();
  const { data, loading, error, reload } = useAsync(() => api<T[]>('GET', endpoint), [endpoint]);
  const [editing, setEditing] = useState<{ row: T | null; form: F } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const [query, setQuery] = useState('');

  const save = async () => {
    if (!editing) return;
    setBusy(true); setFormError(null);
    try {
      const payload = toPayload(editing.form, !editing.row);
      if (editing.row) await api('PATCH', `${endpoint}/${editing.row.id}`, payload);
      else await api('POST', endpoint, payload);
      setEditing(null);
      await reload();
      onSaved?.();
    } catch (e) { setFormError(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!editing?.row || !window.confirm(t('common.confirmDelete'))) return;
    setBusy(true); setFormError(null);
    try { await api('DELETE', `${endpoint}/${editing.row.id}`); setEditing(null); await reload(); }
    catch (e) { setFormError(e); } finally { setBusy(false); }
  };

  const rows = (data ?? []).filter((r) => !query || JSON.stringify(r).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const set = (key: string, value: unknown) => setEditing((e) => (e ? { ...e, form: { ...e.form, [key]: value } } : e));

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={<>
        {exportPath && <ExportButton path={exportPath} filename={exportName ?? 'export.xlsx'} />}
        {canManage && <Button variant="primary" onClick={() => { setFormError(null); setEditing({ row: null, form: emptyForm() }); }}><Icon name="plus" /> {newLabel}</Button>}
      </>} />
      {banner}
      <Card flush>
        <div className="table-toolbar">
          <Input type="search" placeholder={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 280 }} />
          <span className="muted">{rows.length}</span>
        </div>
        {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : rows.length === 0 ? <Empty>{t('common.noData')}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>{columns.map((c) => <th key={c.header} className={c.align === 'right' ? 'r' : ''}>{c.header}</th>)}{canManage && <th />}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={canManage ? 'clickable' : ''} onClick={canManage ? () => { setFormError(null); setEditing({ row: r, form: toForm(r) }); } : undefined}>
                    {columns.map((c) => <td key={c.header} className={c.align === 'right' ? 'r num' : ''}>{c.render(r)}</td>)}
                    {canManage && <td className="r muted"><Icon name="chevron" /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <Modal title={editing.row ? t('common.edit') : newLabel} onClose={() => setEditing(null)} footer={<>
          {editing.row && canDelete && <Button variant="danger" className="mr-auto" onClick={remove} disabled={busy}><Icon name="trash" /> {t('common.delete')}</Button>}
          <Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={busy} onClick={save}>{editing.row ? t('common.save') : t('common.create')}</Button>
        </>}>
          <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {fields.filter((f) => !(f.createOnly && editing.row)).map((f) => {
              const value = editing.form[f.key];
              if (f.type === 'checkbox') {
                return (
                  <label key={f.key} className="check">
                    <input type="checkbox" checked={Boolean(value)} onChange={(e) => set(f.key, e.target.checked)} /> {f.label}
                  </label>
                );
              }
              return (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  {(id) => f.type === 'select'
                    ? <Select id={id} value={String(value ?? '')} options={f.options ?? []} onChange={(e) => set(f.key, e.target.value)} />
                    : <Input id={id} type={f.type ?? 'text'} required={f.required} value={String(value ?? '')} onChange={(e) => set(f.key, e.target.value)} />}
                </Field>
              );
            })}
            <button type="submit" hidden />
          </form>
          <ErrorMessage error={formError} />
        </Modal>
      )}
    </>
  );
}
