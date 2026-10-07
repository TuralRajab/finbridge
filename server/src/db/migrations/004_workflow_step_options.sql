-- Configurable approval stages.
-- Each workflow step decides how it is approved (one assignee or all of them), which actions the approver
-- may take (reject / return), where a return goes (requester or the previous stage), whether an approval
-- needs a comment, and the instructions shown to the approver. Defaults keep the previous behaviour.
ALTER TABLE workflow_steps ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'ANY' CHECK (approval_mode IN ('ANY', 'ALL'));
ALTER TABLE workflow_steps ADD COLUMN allow_reject INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workflow_steps ADD COLUMN allow_return INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workflow_steps ADD COLUMN return_to TEXT NOT NULL DEFAULT 'REQUESTER' CHECK (return_to IN ('REQUESTER', 'PREVIOUS_STEP'));
ALTER TABLE workflow_steps ADD COLUMN require_comment_on_approve INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_steps ADD COLUMN instructions TEXT;

-- Individual decisions per assignee (committee stages). A delegate's decision is recorded on the row of the
-- person they act for; decided_by keeps who actually clicked.
ALTER TABLE workflow_task_assignees ADD COLUMN decision TEXT CHECK (decision IN ('APPROVED', 'REJECTED', 'RETURNED'));
ALTER TABLE workflow_task_assignees ADD COLUMN decided_at TEXT;
ALTER TABLE workflow_task_assignees ADD COLUMN decided_by INTEGER REFERENCES users (id);
ALTER TABLE workflow_task_assignees ADD COLUMN comment TEXT;

-- A task created because a later stage returned the item to this stage ("return to previous step").
ALTER TABLE workflow_tasks ADD COLUMN returned_from_task_id INTEGER REFERENCES workflow_tasks (id);
