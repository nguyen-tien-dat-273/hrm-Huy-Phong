-- Repair project task evidence columns on databases where earlier migrations
-- were recorded/applied incompletely. These columns are read by StaffKanban and
-- written by request_project_task_action.
alter table public.project_task_requests
  add column if not exists evidence_url text,
  add column if not exists evidence_file_path text,
  add column if not exists evidence_file_name text;

alter table public.project_task_requests
  drop constraint if exists project_task_requests_evidence_url_check;
alter table public.project_task_requests
  add constraint project_task_requests_evidence_url_check
  check (
    evidence_url is null
    or (length(evidence_url) <= 2048 and evidence_url ~* '^https?://[^[:space:]]+$')
  );

notify pgrst, 'reload schema';
