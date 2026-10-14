-- Structured learning paths with ordered milestones, checklist steps and review.
alter table public.profiles add column if not exists training_audience text
  check (training_audience is null or training_audience in ('INTERN','PROBATION','PART_TIME','FULL_TIME','OFFICIAL'));

create or replace view public.profiles_directory
with (security_barrier = true)
as
  select id, name, employee_code, department, unit_id, position_id,
         manager_id, role, is_active, avatar_url, employment_status, hire_date, training_audience
  from public.profiles;

revoke all on public.profiles_directory from public, anon;
grant select on public.profiles_directory to authenticated;

create table if not exists public.training_paths (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 2 and 160),
  description text,
  target_groups text[] not null default '{}' check (target_groups <@ array['INTERN','PROBATION','PART_TIME','FULL_TIME','OFFICIAL']::text[]),
  manager_id uuid references public.profiles(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_milestones (
  id uuid primary key default gen_random_uuid(),
  path_id uuid not null references public.training_paths(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  due_days integer check (due_days is null or due_days >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(path_id, sort_order)
);

create table if not exists public.training_path_steps (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.training_milestones(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 240),
  instructions text,
  course_id uuid references public.training_courses(id) on delete set null,
  approver_id uuid not null references public.profiles(id) on delete restrict,
  alternate_approver_id uuid references public.profiles(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(milestone_id, sort_order)
);

create table if not exists public.training_path_assignments (
  id uuid primary key default gen_random_uuid(),
  path_id uuid not null references public.training_paths(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  status text not null default 'in_progress' check (status in ('in_progress','completed','cancelled')),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(path_id, user_id)
);

create table if not exists public.training_step_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.training_path_assignments(id) on delete cascade,
  step_id uuid not null references public.training_path_steps(id) on delete restrict,
  attempt integer not null check (attempt > 0),
  submission_text text,
  file_path text,
  file_name text,
  status text not null default 'pending' check (status in ('pending','approved','revision')),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  unique(assignment_id, step_id, attempt)
);

create index if not exists training_path_assignments_user_idx on public.training_path_assignments(user_id, status);
create index if not exists training_step_submissions_assignment_idx on public.training_step_submissions(assignment_id, submitted_at desc);

alter table public.training_paths enable row level security;
alter table public.training_milestones enable row level security;
alter table public.training_path_steps enable row level security;
alter table public.training_path_assignments enable row level security;
alter table public.training_step_submissions enable row level security;

drop policy if exists training_paths_read on public.training_paths;
create policy training_paths_read on public.training_paths for select to authenticated
using (status = 'published' or created_by = auth.uid() or manager_id = auth.uid() or public.can('training'));
drop policy if exists training_paths_manage on public.training_paths;
create policy training_paths_manage on public.training_paths for all to authenticated
using (public.can('training') or (manager_id = auth.uid() and status = 'draft'))
with check (public.can('training') or (manager_id = auth.uid() and status = 'draft'));

drop policy if exists training_milestones_read on public.training_milestones;
create policy training_milestones_read on public.training_milestones for select to authenticated
using (exists (select 1 from public.training_paths p where p.id = path_id and (p.status = 'published' or p.created_by = auth.uid() or p.manager_id = auth.uid() or public.can('training'))));
drop policy if exists training_milestones_manage on public.training_milestones;
create policy training_milestones_manage on public.training_milestones for all to authenticated
using (public.can('training') or exists(select 1 from public.training_paths p where p.id=path_id and p.manager_id=auth.uid() and p.status='draft'))
with check (public.can('training') or exists(select 1 from public.training_paths p where p.id=path_id and p.manager_id=auth.uid() and p.status='draft'));

drop policy if exists training_path_steps_read on public.training_path_steps;
create policy training_path_steps_read on public.training_path_steps for select to authenticated
using (exists (
  select 1 from public.training_milestones m join public.training_paths p on p.id = m.path_id
  where m.id = milestone_id and (p.status = 'published' or p.created_by = auth.uid() or p.manager_id = auth.uid() or public.can('training'))
));
drop policy if exists training_path_steps_manage on public.training_path_steps;
create policy training_path_steps_manage on public.training_path_steps for all to authenticated
using (public.can('training') or exists(select 1 from public.training_milestones m join public.training_paths p on p.id=m.path_id where m.id=milestone_id and p.manager_id=auth.uid() and p.status='draft'))
with check (public.can('training') or exists(select 1 from public.training_milestones m join public.training_paths p on p.id=m.path_id where m.id=milestone_id and p.manager_id=auth.uid() and p.status='draft'));

drop policy if exists training_path_assignments_read on public.training_path_assignments;
create policy training_path_assignments_read on public.training_path_assignments for select to authenticated
using (user_id = auth.uid() or public.can('training') or exists (
  select 1 from public.training_path_steps s join public.training_milestones m on m.id = s.milestone_id
  where m.path_id = training_path_assignments.path_id and (s.approver_id = auth.uid() or s.alternate_approver_id = auth.uid())
));
drop policy if exists training_path_assignments_manage on public.training_path_assignments;
create policy training_path_assignments_manage on public.training_path_assignments for all to authenticated
using (public.can('training')) with check (public.can('training'));

drop policy if exists training_step_submissions_read on public.training_step_submissions;
create policy training_step_submissions_read on public.training_step_submissions for select to authenticated
using (exists (
  select 1 from public.training_path_assignments a join public.training_path_steps s on s.id = step_id
  where a.id = assignment_id and (a.user_id = auth.uid() or public.can('training') or s.approver_id = auth.uid() or s.alternate_approver_id = auth.uid())
));
drop policy if exists training_step_submissions_manage on public.training_step_submissions;
create policy training_step_submissions_manage on public.training_step_submissions for all to authenticated
using (public.can('training')) with check (public.can('training'));

grant select, insert, update, delete on public.training_paths, public.training_milestones, public.training_path_steps,
  public.training_path_assignments, public.training_step_submissions to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('training-step-submissions','training-step-submissions',false,20971520,array['application/pdf','image/jpeg','image/png','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists training_step_files_read on storage.objects;
create policy training_step_files_read on storage.objects for select to authenticated using (
  bucket_id='training-step-submissions' and split_part(name,'/',1) ~ '^[0-9a-fA-F-]{36}$' and split_part(name,'/',2) ~ '^[0-9a-fA-F-]{36}$'
  and exists(select 1 from public.training_path_assignments a join public.training_path_steps s on s.id::text=split_part(name,'/',2)
    where a.id::text=split_part(name,'/',1) and (a.user_id=auth.uid() or s.approver_id=auth.uid() or s.alternate_approver_id=auth.uid() or public.can('training')))
);
drop policy if exists training_step_files_insert on storage.objects;
create policy training_step_files_insert on storage.objects for insert to authenticated with check (
  bucket_id='training-step-submissions' and split_part(name,'/',1) ~ '^[0-9a-fA-F-]{36}$' and split_part(name,'/',2) ~ '^[0-9a-fA-F-]{36}$'
  and exists(select 1 from public.training_path_assignments a join public.training_path_steps s on s.id::text=split_part(name,'/',2)
    join public.training_milestones m on m.id=s.milestone_id
    where a.id::text=split_part(name,'/',1) and a.user_id=auth.uid() and a.status='in_progress' and m.path_id=a.path_id)
);
drop policy if exists training_step_files_delete on storage.objects;
create policy training_step_files_delete on storage.objects for delete to authenticated using (
  bucket_id='training-step-submissions' and exists(select 1 from public.training_path_assignments a
    where a.id::text=split_part(name,'/',1) and a.user_id=auth.uid())
);

drop policy if exists training_videos_select on storage.objects;
create policy training_videos_select on storage.objects for select to authenticated using (
  bucket_id='training-videos' and (public.can('training') or exists(
    select 1 from public.training_enrollments e
    where e.user_id=auth.uid() and e.course_id::text=(storage.foldername(name))[1]
  ) or exists(
    select 1 from public.training_path_assignments a
    join public.training_milestones m on m.path_id=a.path_id
    join public.training_path_steps s on s.milestone_id=m.id
    join public.training_paths p on p.id=a.path_id
    where a.user_id=auth.uid() and a.status='in_progress' and p.status='published'
      and s.course_id::text=(storage.foldername(name))[1]
  ))
);

create or replace function public.publish_training_path(p_path uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_steps integer; v_missing integer; v_status text;
begin
  if not exists(select 1 from training_paths where id=p_path and (public.can('training') or manager_id=auth.uid())) then raise exception 'Bạn không có quyền xuất bản lộ trình này.'; end if;
  select status into v_status from training_paths where id = p_path for update;
  if not found then raise exception 'Không tìm thấy lộ trình.'; end if;
  if v_status <> 'draft' then raise exception 'Chỉ có thể xuất bản lộ trình nháp.'; end if;
  select count(*), count(*) filter (where s.id is null or s.approver_id is null)
    into v_steps, v_missing
  from training_milestones m left join training_path_steps s on s.milestone_id = m.id where m.path_id = p_path;
  if v_steps = 0 or v_missing > 0 then raise exception 'Lộ trình cần có ít nhất một bước và mỗi bước phải có người kiểm duyệt.'; end if;
  update training_paths set status = 'published', updated_at = now() where id = p_path;
end $$;

create or replace function public.assign_training_path(p_path uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_assignment uuid; v_groups text[]; v_audience text;
begin
  if not public.can('training') then raise exception 'Bạn không có quyền phân công lộ trình.'; end if;
  if not exists(select 1 from training_paths where id=p_path and status='published') then raise exception 'Chỉ phân công được lộ trình đã xuất bản.'; end if;
  select target_groups into v_groups from training_paths where id=p_path;
  select training_audience into v_audience from profiles where id=p_user and is_active;
  if not found then raise exception 'Không tìm thấy nhân viên đang hoạt động.'; end if;
  if cardinality(v_groups)>0 and (v_audience is null or not (v_audience = any(v_groups))) then raise exception 'Nhân viên chưa được phân loại hoặc không thuộc đối tượng của lộ trình.'; end if;
  if exists(select 1 from training_path_assignments where path_id=p_path and user_id=p_user and status <> 'cancelled') then raise exception 'Nhân viên đã được phân công lộ trình này.'; end if;
  if exists(select 1 from training_path_steps s join training_milestones m on m.id=s.milestone_id where m.path_id=p_path and (s.approver_id=p_user or s.alternate_approver_id=p_user)) then raise exception 'Người học không thể là người kiểm duyệt của chính mình.'; end if;
  insert into training_path_assignments(path_id,user_id,assigned_by) values(p_path,p_user,auth.uid()) returning id into v_assignment;
  return v_assignment;
end $$;

create or replace function public.clone_training_path_version(p_path uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_source training_paths%rowtype; v_new uuid; v_m training_milestones%rowtype; v_new_m uuid;
begin
  if not public.can('training') then raise exception 'Bạn không có quyền tạo phiên bản lộ trình.'; end if;
  select * into v_source from training_paths where id=p_path and status='published';
  if not found then raise exception 'Chỉ có thể tạo phiên bản mới từ lộ trình đã xuất bản.'; end if;
  insert into training_paths(title,description,target_groups,manager_id,status,version,created_by)
  values(v_source.title,v_source.description,v_source.target_groups,v_source.manager_id,'draft',v_source.version+1,auth.uid()) returning id into v_new;
  for v_m in select * from training_milestones where path_id=p_path order by sort_order loop
    insert into training_milestones(path_id,title,due_days,sort_order)
    values(v_new,v_m.title,v_m.due_days,v_m.sort_order) returning id into v_new_m;
    insert into training_path_steps(milestone_id,title,instructions,course_id,approver_id,alternate_approver_id,sort_order)
    select v_new_m,title,instructions,course_id,approver_id,alternate_approver_id,sort_order
    from training_path_steps where milestone_id=v_m.id order by sort_order;
  end loop;
  return v_new;
end $$;

drop function if exists public.submit_training_step(uuid,uuid,text);
create or replace function public.submit_training_step(p_assignment uuid, p_step uuid, p_text text default null, p_file_path text default null, p_file_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_step_order integer; v_step_milestone uuid; v_prev uuid; v_attempt integer; v_id uuid;
begin
  select user_id into v_user from training_path_assignments where id=p_assignment and status='in_progress' for update;
  if v_user is distinct from auth.uid() then raise exception 'Lộ trình không thuộc về bạn hoặc đã hoàn tất.'; end if;
  if coalesce(trim(p_text),'')='' and p_file_path is null then raise exception 'Hãy nhập kết quả hoặc đính kèm tệp.'; end if;
  if p_file_path is not null and (p_file_path not like p_assignment::text || '/' || p_step::text || '/%' or not exists(select 1 from storage.objects where bucket_id='training-step-submissions' and name=p_file_path)) then raise exception 'Tệp đính kèm không hợp lệ hoặc không đúng bước đào tạo.'; end if;
  select s.sort_order, s.milestone_id into v_step_order, v_step_milestone from training_path_steps s where s.id=p_step;
  if not found then raise exception 'Không tìm thấy bước đào tạo.'; end if;
  if not exists(select 1 from training_milestones m join training_paths p on p.id=m.path_id join training_path_assignments a on a.path_id=p.id where m.id=v_step_milestone and a.id=p_assignment and p.status='published') then raise exception 'Bước này không thuộc lộ trình của bạn.'; end if;
  -- Find the immediately preceding step in flattened milestone/step order.
  select prev.id into v_prev from training_path_steps cur
   join training_milestones cm on cm.id=cur.milestone_id
   join training_milestones pm on pm.path_id=cm.path_id
   join training_path_steps prev on prev.milestone_id=pm.id
   where cur.id=p_step and (pm.sort_order < cm.sort_order or (pm.sort_order=cm.sort_order and prev.sort_order<cur.sort_order))
   order by pm.sort_order desc, prev.sort_order desc limit 1;
  if v_prev is not null and not exists(select 1 from training_step_submissions where assignment_id=p_assignment and step_id=v_prev and status='approved') then raise exception 'Bước trước chưa được duyệt.'; end if;
  if exists(select 1 from training_step_submissions where assignment_id=p_assignment and step_id=p_step and status='pending') then raise exception 'Bước này đang chờ kiểm duyệt.'; end if;
  select coalesce(max(attempt),0)+1 into v_attempt from training_step_submissions where assignment_id=p_assignment and step_id=p_step;
  insert into training_step_submissions(assignment_id,step_id,attempt,submission_text,file_path,file_name)
  values(p_assignment,p_step,v_attempt,nullif(trim(p_text),''),p_file_path,p_file_name) returning id into v_id;
  return v_id;
end $$;

create or replace function public.review_training_step(p_submission uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_assignment uuid; v_step uuid; v_path uuid; v_approver uuid; v_pending integer; v_open integer;
begin
  select a.id,s.id,p.id,case when s.approver_id=auth.uid() then s.approver_id else s.alternate_approver_id end
   into v_assignment,v_step,v_path,v_approver
  from training_step_submissions sub join training_path_assignments a on a.id=sub.assignment_id
  join training_path_steps s on s.id=sub.step_id join training_milestones m on m.id=s.milestone_id join training_paths p on p.id=m.path_id
  where sub.id=p_submission and sub.status='pending' for update of sub;
  if not found then raise exception 'Phiếu không còn chờ duyệt.'; end if;
  if v_approver is distinct from auth.uid() and not public.can('training') then raise exception 'Bạn không phải người kiểm duyệt bước này.'; end if;
  if not p_approve and coalesce(trim(p_note),'')='' then raise exception 'Cần nhập lý do khi yêu cầu làm lại.'; end if;
  update training_step_submissions set status=case when p_approve then 'approved' else 'revision' end,
   reviewed_by=auth.uid(), reviewed_at=now(), review_note=nullif(trim(p_note),'') where id=p_submission;
  if p_approve then
    select count(*) into v_pending from training_step_submissions where assignment_id=v_assignment and status='pending';
    select count(*) into v_open from training_path_steps s join training_milestones m on m.id=s.milestone_id
      where m.path_id=v_path and not exists(select 1 from training_step_submissions x where x.assignment_id=v_assignment and x.step_id=s.id and x.status='approved');
    if v_pending=0 and v_open=0 then update training_path_assignments set status='completed',completed_at=now() where id=v_assignment; end if;
  end if;
end $$;

create or replace function public.start_onboarding_after_training()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_audience text; v_manager uuid; v_process uuid;
begin
  if old.status is distinct from 'completed' and new.status = 'completed' then
    select p.training_audience, t.manager_id into v_audience, v_manager
    from profiles p join training_paths t on t.id=new.path_id where p.id=new.user_id;
    if v_audience in ('INTERN','PROBATION') then
      if not exists(select 1 from employee_lifecycle_processes where user_id=new.user_id and process_type='ONBOARDING' and status='ACTIVE') then
        insert into employee_lifecycle_processes(user_id,process_type,title,start_date,target_date,mentor_id)
        values(new.user_id,'ONBOARDING','Hội nhập sau đào tạo',current_date,current_date+60,v_manager)
        returning id into v_process;
        insert into employee_checklist_items(process_id,title,owner_id,order_index) values
          (v_process,'Hoàn thiện hồ sơ nhân sự và thông tin cần thiết',v_manager,0),
          (v_process,'Nhận tài khoản và công cụ làm việc',v_manager,1),
          (v_process,'Nắm nội quy, chính sách và quy trình nội bộ',v_manager,2),
          (v_process,'Trao đổi với quản lý về mục tiêu công việc',v_manager,3),
          (v_process,'Đánh giá hội nhập sau 30 ngày',v_manager,4),
          (v_process,'Đánh giá hoàn tất hội nhập sau 60 ngày',v_manager,5);
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists training_path_completed_onboarding on public.training_path_assignments;
create trigger training_path_completed_onboarding after update of status on public.training_path_assignments
for each row execute function public.start_onboarding_after_training();

create or replace function public.log_training_path_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_row jsonb; v_target uuid; v_target_name text;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new,v_old);
  if tg_table_name = 'training_path_assignments' then v_target := nullif(v_row->>'user_id','')::uuid;
  elsif tg_table_name = 'training_step_submissions' then
    select user_id into v_target from training_path_assignments where id=nullif(v_row->>'assignment_id','')::uuid;
  end if;
  select name into v_target_name from profiles where id=v_target;
  insert into audit_logs(actor_id,actor_name,action,entity_type,entity_id,target_user_id,target_name,summary,details)
  values(auth.uid(),(select name from profiles where id=auth.uid()),
    'training.'||tg_table_name||'.'||lower(tg_op),tg_table_name,v_row->>'id',v_target,v_target_name,
    'Thay đổi dữ liệu lộ trình đào tạo: '||coalesce(v_row->>'title',v_row->>'status',v_row->>'id',''),
    jsonb_build_object('old',v_old,'new',v_new));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists training_paths_audit on public.training_paths;
create trigger training_paths_audit after insert or update or delete on public.training_paths for each row execute function public.log_training_path_change();
drop trigger if exists training_milestones_audit on public.training_milestones;
create trigger training_milestones_audit after insert or update or delete on public.training_milestones for each row execute function public.log_training_path_change();
drop trigger if exists training_path_steps_audit on public.training_path_steps;
create trigger training_path_steps_audit after insert or update or delete on public.training_path_steps for each row execute function public.log_training_path_change();
drop trigger if exists training_path_assignments_audit on public.training_path_assignments;
create trigger training_path_assignments_audit after insert or update or delete on public.training_path_assignments for each row execute function public.log_training_path_change();
drop trigger if exists training_step_submissions_audit on public.training_step_submissions;
create trigger training_step_submissions_audit after insert or update or delete on public.training_step_submissions for each row execute function public.log_training_path_change();

revoke all on function public.publish_training_path(uuid), public.assign_training_path(uuid,uuid), public.clone_training_path_version(uuid), public.submit_training_step(uuid,uuid,text,text,text), public.review_training_step(uuid,boolean,text), public.start_onboarding_after_training(), public.log_training_path_change() from public;
grant execute on function public.publish_training_path(uuid), public.assign_training_path(uuid,uuid), public.clone_training_path_version(uuid), public.submit_training_step(uuid,uuid,text,text,text), public.review_training_step(uuid,boolean,text) to authenticated;
