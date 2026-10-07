import { useState } from 'react';
import type { TaskAction, WorkflowInstanceDto, WorkflowTaskDto } from '@finbridge/shared';
import '../styles/workflow.css';
import { api } from '../api/client';
import { fmt, useI18n, useLocal, type TKey } from '../i18n';
import { useAsync } from '../lib/useAsync';
import { date } from '../lib/format';
import { ActionDialog, Badge, Button, Card, ErrorMessage, InstanceStatusBadge, Spinner, TaskStatusBadge } from './ui';

const az = {
  instructions: 'Təlimat',
  modeAll: 'Hamısı təsdiqləməlidir',
  progress: '{done} / {total} təsdiq',
  approvedBy: 'təsdiqləyib',
  rejectedBy: 'rədd edib',
  returnedBy: 'qaytarıb',
  waiting: 'gözlənilir',
  viaDelegate: '{name} tərəfindən (səlahiyyət ötürülməsi ilə)',
  forPerson: '{name} adından',
  noReject: 'Bu mərhələdə rədd etmək mümkün deyil',
  noReturn: 'Bu mərhələdə qaytarmaq mümkün deyil',
  commentOnApprove: 'Təsdiq üçün şərh məcburidir',
  returnToPrev: 'Qaytarma əvvəlki mərhələyə gedir',
  returnedFrom: '«{step}» mərhələsindən geri qaytarılıb{by}',
  returnedByName: ' — {name}',
  youApproved: 'Siz bu mərhələni təsdiqləmisiniz — digər üzvlərin qərarı gözlənilir.',
  youDecided: 'Bu mərhələ üzrə qərarınız qeydə alınıb.',
  approveHintAll: 'Sizin təsdiqiniz qeydə alınacaq. Mərhələ bütün üzvlər təsdiqlədikdən sonra tamamlanır ({done} / {total}).',
  approveHintComment: 'Bu mərhələdə təsdiqi şərhlə əsaslandırmaq lazımdır.',
  returnHintPrev: 'Sənəd əvvəlki mərhələyə — «{step}» — yenidən baxış üçün qaytarılacaq; təsdiq prosesi davam edir. Nəyin düzəldilməli olduğunu yazın.',
  returnHintPrevNone: 'Əvvəlki mərhələ olmadığı üçün sənəd göndərənə qaytarılacaq. Nəyin düzəldilməli olduğunu yazın.',
  partial: 'Təsdiq (qismən)',
  approveOnly: 'Bu mərhələdə yalnız təsdiq mümkündür.',
};
const TEXT = {
  az,
  en: {
    instructions: 'Instructions',
    modeAll: 'Everyone must approve',
    progress: '{done} / {total} approvals',
    approvedBy: 'approved',
    rejectedBy: 'rejected',
    returnedBy: 'returned',
    waiting: 'waiting',
    viaDelegate: 'by {name} (delegation)',
    forPerson: 'on behalf of {name}',
    noReject: 'Rejecting is not allowed at this stage',
    noReturn: 'Returning is not allowed at this stage',
    commentOnApprove: 'A comment is required to approve',
    returnToPrev: 'A return goes to the previous stage',
    returnedFrom: 'Returned from stage “{step}”{by}',
    returnedByName: ' — {name}',
    youApproved: 'You approved this stage — waiting for the other members.',
    youDecided: 'Your decision on this stage has been recorded.',
    approveHintAll: 'Your approval is recorded. The stage completes once every member has approved ({done} / {total}).',
    approveHintComment: 'This stage requires a comment to justify the approval.',
    returnHintPrev: 'The document goes back to the previous stage — “{step}” — for another review; the approval continues. Describe what needs to change.',
    returnHintPrevNone: 'There is no previous stage, so the document goes back to the requester. Describe what needs to change.',
    partial: 'Approval (partial)',
    approveOnly: 'Only approval is possible at this stage.',
  } satisfies typeof az,
};

/**
 * Approval timeline for any workflow-driven entity: steps, resolved approvers (incl. delegates
 * and escalations), SLA, stage instructions, committee progress, the append-only action history and —
 * when the current user is an assignee — the actions the stage allows. `onChanged` lets the page reload the entity.
 */
export function WorkflowPanel({ instanceId, onChanged, title }: { instanceId: number | null | undefined; onChanged?: () => void; title?: string }) {
  const { t } = useI18n();
  if (!instanceId) {
    return <Card title={title ?? t('workflow.title')}><p className="muted">{t('workflow.noInstance')}</p></Card>;
  }
  return <WorkflowPanelInner key={instanceId} instanceId={instanceId} onChanged={onChanged} title={title} />;
}

/** The stage a "return to previous step" would re-open: latest approved task of an earlier stage. */
function previousStage(inst: WorkflowInstanceDto, task: WorkflowTaskDto): WorkflowTaskDto | null {
  const earlier = inst.tasks.filter((x) => x.seq < task.seq && x.status === 'APPROVED' && x.id < task.id);
  return earlier.sort((a, b) => b.seq - a.seq || b.id - a.id)[0] ?? null;
}

function WorkflowPanelInner({ instanceId, onChanged, title }: { instanceId: number; onChanged?: () => void; title?: string }) {
  const { t, locale } = useI18n();
  const L = useLocal(TEXT);
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

  const pending = inst.tasks.find((x) => x.status === 'PENDING') ?? null;
  const myTask = inst.myTaskId ? inst.tasks.find((x) => x.id === inst.myTaskId) ?? null : null;
  const prev = myTask && myTask.returnTo === 'PREVIOUS_STEP' ? previousStage(inst, myTask) : null;

  const approveHint = [
    myTask?.approvalMode === 'ALL' ? fmt(L.approveHintAll, { done: myTask.approvalsDone, total: myTask.approvalsRequired }) : t('workflow.approveHint'),
    myTask?.requireCommentOnApprove ? L.approveHintComment : '',
  ].filter(Boolean).join(' ');
  const returnHint = myTask?.returnTo === 'PREVIOUS_STEP'
    ? prev ? fmt(L.returnHintPrev, { step: prev.stepName }) : L.returnHintPrevNone
    : t('workflow.returnHint');

  const dialogs: Record<TaskAction | 'CANCEL', { title: string; hint: string; required: boolean; danger?: boolean }> = {
    APPROVE: { title: t('common.approve'), hint: approveHint, required: !!myTask?.requireCommentOnApprove },
    REJECT: { title: t('common.reject'), hint: t('workflow.rejectHint'), required: true, danger: true },
    RETURN: { title: t('common.return'), hint: returnHint, required: true },
    CANCEL: { title: t('common.cancelRequest'), hint: t('workflow.cancelHint'), required: false, danger: true },
  };

  const actionLabel = (a: WorkflowInstanceDto['actions'][number]) => {
    if (a.action === 'APPROVE' && a.toStatus === 'PENDING') return L.partial;
    const key = `workflowAction.${a.action}`;
    const s = t(key as TKey);
    return s === key ? a.action : s;
  };

  return (
    <Card
      title={title ?? t('workflow.title')}
      subtitle={<>{t('workflow.definition')}: <b>{inst.definitionName}</b> · {t('workflow.startedBy')}: {inst.startedBy} · {date(inst.startedAt, locale, true)}</>}
      actions={<InstanceStatusBadge status={inst.status} />}
    >
      <div className="wf">
        {inst.canAct && myTask && (
          <div className="alert alert-warning">
            <b>{t('workflow.yourTurn')}</b>
            {myTask.instructions && <div className="wfpn-instructions wfpn-turn-instr"><b>{L.instructions}:</b> {myTask.instructions}</div>}
            <div className="wf-actions" style={{ marginTop: 8 }}>
              <Button variant="success" onClick={() => setDialog('APPROVE')}>{t('common.approve')}</Button>
              {myTask.allowReturn && <Button onClick={() => setDialog('RETURN')}>{t('common.return')}</Button>}
              {myTask.allowReject && <Button variant="danger" onClick={() => setDialog('REJECT')}>{t('common.reject')}</Button>}
            </div>
            {(!myTask.allowReject || !myTask.allowReturn || myTask.requireCommentOnApprove) && (
              <div className="wfpn-flags small">
                {!myTask.allowReject && !myTask.allowReturn
                  ? <Badge tone="muted">{L.approveOnly}</Badge>
                  : <>
                    {!myTask.allowReject && <Badge tone="muted">{L.noReject}</Badge>}
                    {!myTask.allowReturn && <Badge tone="muted">{L.noReturn}</Badge>}
                  </>}
                {myTask.requireCommentOnApprove && <Badge tone="info">{L.commentOnApprove}</Badge>}
              </div>
            )}
          </div>
        )}
        {!inst.canAct && inst.myDecision && pending && inst.status === 'IN_REVIEW' && (
          <div className="alert alert-info">{inst.myDecision === 'APPROVED' ? L.youApproved : L.youDecided}</div>
        )}
        <ol className="wf-steps">
          {inst.tasks.map((task) => <TaskRow key={task.id} task={task} L={L} />)}
        </ol>
        {inst.canCancel && (
          <div><Button variant="ghost" onClick={() => setDialog('CANCEL')}>{t('common.cancelRequest')}</Button></div>
        )}
        <details>
          <summary className="muted">{t('workflow.history')} ({inst.actions.length})</summary>
          <ul className="wf-history">
            {inst.actions.map((a) => (
              <li key={a.id}>
                <span className="muted">{date(a.createdAt, locale, true)}</span> · <b>{actionLabel(a)}</b> · {a.userName}
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

function TaskRow({ task, L }: { task: WorkflowTaskDto; L: typeof az }) {
  const { t, locale } = useI18n();
  const isAll = task.approvalMode === 'ALL';
  const required = task.assignees.filter((a) => a.required);
  const others = task.assignees.filter((a) => !a.required);
  const pct = task.approvalsRequired ? Math.round((task.approvalsDone / task.approvalsRequired) * 100) : 0;
  const decisionText = (d: string) => (d === 'APPROVED' ? L.approvedBy : d === 'REJECTED' ? L.rejectedBy : L.returnedBy);
  return (
    <li className={`wf-step is-${task.status}`}>
      <span className="wf-dot">{task.seq}</span>
      <div>
        <div>
          <b>{task.stepName}</b> <span className="wf-meta">· {t(`approverType.${task.approverType}` as TKey)}</span>
          {isAll && <> <Badge tone="info">{L.modeAll}</Badge></>}
        </div>
        {task.returnedFrom && (
          <div className="wfpn-returned">
            ↩ {fmt(L.returnedFrom, { step: task.returnedFrom.stepName, by: task.returnedFrom.by ? fmt(L.returnedByName, { name: task.returnedFrom.by }) : '' })}
            {task.returnedFrom.at && <> · {date(task.returnedFrom.at, locale, true)}</>}
            {task.returnedFrom.comment && <> — “{task.returnedFrom.comment}”</>}
          </div>
        )}
        {isAll ? (
          <>
            <div className="wfpn-progress">
              <span className="wfpn-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
              <b>{fmt(L.progress, { done: task.approvalsDone, total: task.approvalsRequired })}</b>
            </div>
            <ul className="wfpn-votes">
              {required.map((a) => (
                <li key={a.userId}>
                  <span>{a.name}{a.reason !== 'RESOLVED' && <> ({t(`assigneeReason.${a.reason}` as TKey)})</>}:</span>
                  {a.decision ? (
                    <>
                      <span className={a.decision === 'APPROVED' ? 'wfpn-vote-ok' : 'wfpn-vote-no'}>{a.decision === 'APPROVED' ? '✓' : '✕'} {decisionText(a.decision)}</span>
                      {a.decidedBy && a.decidedBy !== a.name && <span className="wf-meta">{fmt(L.viaDelegate, { name: a.decidedBy })}</span>}
                      {a.decidedAt && <span className="wf-meta">· {date(a.decidedAt, locale, true)}</span>}
                      {a.decisionComment && <span className="wf-meta">— “{a.decisionComment}”</span>}
                    </>
                  ) : <span className="wfpn-vote-wait">○ {task.status === 'PENDING' ? L.waiting : '—'}</span>}
                </li>
              ))}
              {others.map((a) => (
                <li key={a.userId} className="wf-meta">
                  {a.name} ({t(`assigneeReason.${a.reason}` as TKey)}{a.onBehalfOf ? `, ${fmt(L.forPerson, { name: a.onBehalfOf })}` : ''})
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="wf-meta">
            {task.assignees.map((a, i) => (
              <span key={a.userId}>
                {i > 0 && ', '}
                {a.name}{a.reason !== 'RESOLVED' && <> ({t(`assigneeReason.${a.reason}` as TKey)}{a.onBehalfOf ? `, ${fmt(L.forPerson, { name: a.onBehalfOf })}` : ''})</>}
              </span>
            ))}
          </div>
        )}
        {task.dueAt && task.status === 'PENDING' && (
          <div className="wf-meta">{t('common.due')}: {date(task.dueAt, locale, true)} {task.isOverdue && <Badge tone="danger">{t('common.overdue')}</Badge>}</div>
        )}
        {task.instructions && task.status === 'PENDING' && <div className="wfpn-instructions"><b>{L.instructions}:</b> {task.instructions}</div>}
        {task.status === 'PENDING' && task.allowReturn && task.returnTo === 'PREVIOUS_STEP' && <div className="wf-meta">↩ {L.returnToPrev}</div>}
        {task.actedBy && <div className="wf-meta">{task.actedBy} · {date(task.actedAt, locale, true)}</div>}
        {task.comment && <div className="tl-comment">“{task.comment}”</div>}
      </div>
      <TaskStatusBadge status={task.status} />
    </li>
  );
}
