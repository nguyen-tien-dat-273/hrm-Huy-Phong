-- Track checklist state and keep an immutable history of lifecycle work.
alter table public.employee_checklist_items
  add column if not exists status text not null default 'OPEN'
  check (status in ('OPEN', 'IN_PROGRESS', 'COMPLETED'));

update public.employee_checklist_items
set status = case when completed then 'COMPLETED' else 'OPEN' end;

create or replace function public.sync_lifecycle_checklist_status()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.completed := new.status = 'COMPLETED';
    if new.completed and new.completed_at is null then new.completed_at := now(); end if;
    if not new.completed then new.completed_at := null; end if;
  elsif new.status is distinct from old.status then
    new.completed := new.status = 'COMPLETED';
    new.completed_at := case when new.completed then now() else null end;
  elsif new.completed is distinct from old.completed then
    new.status := case when new.completed then 'COMPLETED' else 'OPEN' end;
    new.completed_at := case when new.completed then coalesce(new.completed_at, now()) else null end;
  end if;
  return new;
end;
$$;

drop trigger if exists lifecycle_checklist_status_sync on public.employee_checklist_items;
create trigger lifecycle_checklist_status_sync
before insert or update of status, completed on public.employee_checklist_items
for each row execute function public.sync_lifecycle_checklist_status();

create or replace function public.refresh_lifecycle_process_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_process_id uuid;
begin
  if tg_op = 'DELETE' then v_process_id := old.process_id; else v_process_id := new.process_id; end if;
  if exists (select 1 from public.employee_checklist_items where process_id = v_process_id)
     and not exists (select 1 from public.employee_checklist_items where process_id = v_process_id and status <> 'COMPLETED') then
    update public.employee_lifecycle_processes set status = 'COMPLETED' where id = v_process_id and status = 'ACTIVE';
  elsif exists (select 1 from public.employee_checklist_items where process_id = v_process_id and status = 'IN_PROGRESS') then
    update public.employee_lifecycle_processes set status = 'ACTIVE' where id = v_process_id and status = 'COMPLETED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists lifecycle_checklist_refresh_process on public.employee_checklist_items;
create trigger lifecycle_checklist_refresh_process after insert or update of status, completed or delete on public.employee_checklist_items
for each row execute function public.refresh_lifecycle_process_status();

create or replace function public.guard_lifecycle_checklist_assignee_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not public.can_function('admin.employee_lifecycle') and (
    (to_jsonb(new) - array['status','completed','completed_at','updated_at'])
      is distinct from (to_jsonb(old) - array['status','completed','completed_at','updated_at'])
  ) then
    raise exception 'Người được giao chỉ có thể cập nhật trạng thái checklist.';
  end if;
  return new;
end;
$$;
drop trigger if exists lifecycle_checklist_assignee_guard on public.employee_checklist_items;
create trigger lifecycle_checklist_assignee_guard before update on public.employee_checklist_items
for each row execute function public.guard_lifecycle_checklist_assignee_update();

create table if not exists public.employee_lifecycle_history (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.employee_lifecycle_processes(id) on delete cascade,
  checklist_item_id uuid references public.employee_checklist_items(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('PROCESS_CREATED','PROCESS_UPDATED','CHECKLIST_CREATED','CHECKLIST_UPDATED','CHECKLIST_DELETED')),
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index if not exists employee_lifecycle_history_process_idx
  on public.employee_lifecycle_history(process_id, created_at desc);
alter table public.employee_lifecycle_history enable row level security;

drop policy if exists lifecycle_history_read on public.employee_lifecycle_history;
create policy lifecycle_history_read on public.employee_lifecycle_history for select to authenticated
using (
  public.can_function('admin.employee_lifecycle')
  or exists (
    select 1 from public.employee_lifecycle_processes p
    where p.id = process_id and (
      p.user_id = auth.uid() or p.mentor_id = auth.uid()
      or public.owns_lifecycle_checklist(p.id)
    )
  )
);
grant select on public.employee_lifecycle_history to authenticated;

create or replace function public.log_employee_lifecycle_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_process_id uuid;
  v_item_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_action text;
begin
  if tg_table_name = 'employee_lifecycle_processes' then
    if tg_op = 'DELETE' then return old; end if;
    v_process_id := coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid);
    v_action := case when tg_op = 'INSERT' then 'PROCESS_CREATED' else 'PROCESS_UPDATED' end;
    if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
    if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  else
    v_item_id := coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid);
    v_process_id := coalesce((to_jsonb(new)->>'process_id')::uuid, (to_jsonb(old)->>'process_id')::uuid);
    v_action := case when tg_op = 'INSERT' then 'CHECKLIST_CREATED' when tg_op = 'DELETE' then 'CHECKLIST_DELETED' else 'CHECKLIST_UPDATED' end;
    if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
    if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  end if;
  insert into public.employee_lifecycle_history(process_id, checklist_item_id, actor_id, action, old_values, new_values)
  values (v_process_id, v_item_id, auth.uid(), v_action, v_old, v_new);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists employee_lifecycle_processes_history on public.employee_lifecycle_processes;
create trigger employee_lifecycle_processes_history after insert or update or delete on public.employee_lifecycle_processes
for each row execute function public.log_employee_lifecycle_change();
drop trigger if exists employee_checklist_items_history on public.employee_checklist_items;
create trigger employee_checklist_items_history after insert or update or delete on public.employee_checklist_items
for each row execute function public.log_employee_lifecycle_change();

-- Keep the automatic post-training handoff useful: assign actionable employee
-- steps to the learner, and setup/review steps to their manager when available.
create or replace function public.start_onboarding_after_training()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_audience text; v_manager uuid; v_process uuid;
begin
  if old.status is distinct from 'completed' and new.status = 'completed' then
    select p.training_audience, t.manager_id into v_audience, v_manager
    from public.profiles p join public.training_paths t on t.id = new.path_id where p.id = new.user_id;
    if v_audience in ('INTERN','PROBATION') and not exists (
      select 1 from public.employee_lifecycle_processes where user_id = new.user_id and process_type = 'ONBOARDING' and status = 'ACTIVE'
    ) then
      insert into public.employee_lifecycle_processes(user_id,process_type,title,start_date,target_date,mentor_id)
      values(new.user_id,'ONBOARDING','Hội nhập sau đào tạo',current_date,current_date+60,v_manager)
      returning id into v_process;
      insert into public.employee_checklist_items(process_id,title,owner_id,due_date,order_index) values
        (v_process,'Hoàn thiện hồ sơ nhân sự và thông tin cần thiết',new.user_id,current_date+7,0),
        (v_process,'Nhận tài khoản và công cụ làm việc',coalesce(v_manager,new.user_id),current_date+1,1),
        (v_process,'Nắm nội quy, chính sách và quy trình nội bộ',coalesce(v_manager,new.user_id),current_date+3,2),
        (v_process,'Trao đổi với quản lý về mục tiêu công việc',coalesce(v_manager,new.user_id),current_date+7,3),
        (v_process,'Đánh giá hội nhập sau 30 ngày',coalesce(v_manager,new.user_id),current_date+30,4),
        (v_process,'Đánh giá hoàn tất hội nhập sau 60 ngày',coalesce(v_manager,new.user_id),current_date+60,5);
    end if;
  end if;
  return new;
end;
$$;

-- User-owned write access is limited to changing their own task status. The
-- trigger keeps completed/completed_at compatible with older parts of HRM.
drop policy if exists lifecycle_checklist_assignee_update on public.employee_checklist_items;
create policy lifecycle_checklist_assignee_update on public.employee_checklist_items for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());
