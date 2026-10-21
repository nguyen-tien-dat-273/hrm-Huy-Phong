-- Nhật ký sửa tay giờ vào / giờ ra trên bảng công: ai sửa, ngày nào, giờ cũ, giờ mới, vì sao.
create table if not exists public.attendance_edit_logs (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid references public.attendance(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  action text not null check (action in ('UPDATE', 'CREATE')),
  old_check_in timestamptz,
  old_check_out timestamptz,
  new_check_in timestamptz not null,
  new_check_out timestamptz not null,
  reason text not null check (char_length(trim(reason)) >= 3),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists attendance_edit_logs_user_date_idx
  on public.attendance_edit_logs(user_id, work_date);

alter table public.attendance_edit_logs enable row level security;

drop policy if exists attendance_edit_logs_read on public.attendance_edit_logs;
create policy attendance_edit_logs_read on public.attendance_edit_logs
  for select to authenticated
  using (public.is_admin() or actor_id = auth.uid());

drop policy if exists attendance_edit_logs_insert on public.attendance_edit_logs;
create policy attendance_edit_logs_insert on public.attendance_edit_logs
  for insert to authenticated
  with check (actor_id = auth.uid());

grant select, insert on public.attendance_edit_logs to authenticated;
