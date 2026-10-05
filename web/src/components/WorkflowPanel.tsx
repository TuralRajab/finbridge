import { useState } from 'react';
import type { TaskAction, WorkflowInstanceDto } from '@finbridge/shared';
import { api } from '../api/client';
import { useI18n, type TKey } from '../i18n';
import { useAsync } from '../lib/useAsync';
import { date } from '../lib/format';
import { ActionDialog, Badge, Button, Card, ErrorMessage, InstanceStatusBadge, Spinner, TaskStatusBadge } from './ui';

/**
 * Approval timeline for any workflow-driven entity: steps, resolved approvers (incl. delegates
 * and escalations), SLA, the append-only action history and — when the current user is an
 * assignee — the approve / reject / return actions. `onChanged` lets the page reload the entity.
 */
export function WorkflowPanel({ instanceId, onChanged, title }: { instanceId: number | null | undefined; onChanged?: () => void; title?: string }) {
  const { t } = useI18n();
  if (!instanceId) {
    return <Card title={title ?? t('workflow.title')}><p className="muted">{t('workflow.noInstance')}</p></Card>;
  }
  return <WorkflowPanelInner key={instanceId} instanceId={instanceId} onChanged={onChanged} title={title} />;
}

function WorkflowPanelInner({ instanceId, onChanged, title }: { instanceId: number; onChanged?: () => void; title?: string }) {
  const { t, locale } = useI18n();
  const { data: inst, error, loading, setData } = useAsync(() => api<WorkflowInstanceDto>('GET', `/workflows/instances/${instanceId}`), [instanceId]);
  const [dialog, setDialog] = useState<TaskAction | 'CANCEL' | null>(null);

  if (loading && !inst) return <Card title={title ?? t('workflow.title')}><Spinner /></Card>;
  if (error || !inst) return <Card title={title ?? t('workflow.title')}><ErrorMessage error={error} /></Card>;

  const act = async (action: TaskAction | 'CANCEL', comment: string) => {
    const next = action === 'CANCEL'
      ? await api<WorkflowInstanceDto>('POST', `/workflows/instances/${inst.id}/cancel`, { comment: comment || null })
      : await api<WorkflowInstanceDto>('POST', `/workflows/tasks/${inst.myTaskId}/act`, { action, comment: comment || null });
    setData(next);
    onChanged?.();
  };

  const dialogs: Record<TaskAction | 'CANCEL', { title: string; hint: string; required: boolean; danger?: boolean }> = {
    APPROVE: { title: t('common.approve'), hint: t('workflow.approveHint'), required: false },
    REJECT: { title: t('common.reject'), hint: t('workflow.rejectHint'), required: true, danger: true },
    RETURN: { title: t('common.return'), hint: t('workflow.returnHint'), required: true },
    CANCEL: { title: t('common.cancelRequest'), hint: t('workflow.cancelHint'), required: false, danger: true },
  };

  return (
    <Card
      title={title ?? t('workflow.title')}
      subtitle={<>{t('workflow.definition')}: <b>{inst.definitionName}</b> · {t('workflow.startedBy')}: {inst.startedBy} · {date(inst.startedAt, locale, true)}</>}
      actions={<InstanceStatusBadge status={inst.status} />}
    >
      <div className="wf">
        {inst.canAct && (
          <div className="alert alert-warning">
            <b>{t('workflow.yourTurn')}</b>
            <div className="wf-actions" style={{ marginTop: 8 }}>
              <Button variant="success" onClick={() => setDialog('APPROVE')}>{t('common.approve')}</Button>
              <Button onClick={() => setDialog('RETURN')}>{t('common.return')}</Button>
              <Button variant="danger" onClick={() => setDialog('REJECT')}>{t('common.reject')}</Button>
            </div>
          </div>
        )}
        <ol className="wf-steps">
          {inst.tasks.map((task) => (
            <li key={task.id} className={`wf-step is-${task.status}`}>
              <span className="wf-dot">{task.seq}</span>
              <div>
                <div><b>{task.stepName}</b> <span className="wf-meta">· {t(`approverType.${task.approverType}` as TKey)}</span></div>
                <div className="wf-meta">
                  {task.assignees.map((a, i) => (
                    <span key={a.userId}>
                      {i > 0 && ', '}
                      {a.name}{a.reason !== 'RESOLVED' && <> ({t(`assigneeReason.${a.reason}` as TKey)})</>}
                    </span>
                  ))}
                  {task.dueAt && task.status === 'PENDING' && (
                    <> · {t('common.due')}: {date(task.dueAt, locale, true)} {task.isOverdue && <Badge tone="danger">{t('common.overdue')}</Badge>}</>
                  )}
                </div>
                {task.actedBy && <div className="wf-meta">{task.actedBy} · {date(task.actedAt, locale, true)}</div>}
                {task.comment && <div className="tl-comment">“{task.comment}”</div>}
              </div>
              <TaskStatusBadge status={task.status} />
            </li>
          ))}
        </ol>
        {inst.canCancel && (
          <div><Button variant="ghost" onClick={() => setDialog('CANCEL')}>{t('common.cancelRequest')}</Button></div>
        )}
        <details>
          <summary className="muted">{t('workflow.history')} ({inst.actions.length})</summary>
          <ul className="wf-history">
            {inst.actions.map((a) => (
              <li key={a.id}>
                <span className="muted">{date(a.createdAt, locale, true)}</span> · <b>{t(`workflowAction.${a.action}` as TKey) || a.action}</b> · {a.userName}
                {a.comment && <> — “{a.comment}”</>}
              </li>
            ))}
          </ul>
        </details>
      </div>
      {dialog && (
        <ActionDialog
          title={dialogs[dialog].title}
          hint={dialogs[dialog].hint}
          commentRequired={dialogs[dialog].required}
          danger={dialogs[dialog].danger}
          confirmLabel={dialogs[dialog].title}
          onConfirm={(c) => act(dialog, c)}
          onClose={() => setDialog(null)}
        />
      )}
    </Card>
  );
}
