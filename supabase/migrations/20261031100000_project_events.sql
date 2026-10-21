-- Lịch họp & nhắc nhở dự án (tab "Lịch họp" trong chi tiết dự án).
-- Thành viên dự án xem được; admin/ceo, người có quyền dự án (không phải
-- teamlead) và trưởng nhóm của chính dự án đó được tạo/sửa/xoá. Khi tạo, trigger
-- bắn thông báo cho thành viên nên client không cần notify tay.

create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null default 'meeting' check (type in ('meeting', 'reminder')),
  title text not null check (length(trim(title)) > 0),
  description text,
  client_name text,
  location text,
  start_at timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_events_project_start_idx
  on public.project_events(project_id, start_at);
create index if not exists project_events_start_idx
  on public.project_events(start_at);

create or replace function public.can_manage_project_events(target_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and (
        p.role in ('admin', 'ceo')
        or (p.role <> 'teamlead' and 'projects' = any(coalesce(p.permissions, '{}')))
        or exists (select 1 from public.projects pr where pr.id = target_project and pr.lead_id = p.id)
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = target_project and pm.user_id = p.id
            and coalesce(pm.role_code, pm.role) = 'lead'
        )
      )
  );
$$;

revoke all on function public.can_manage_project_events(uuid) from public;
grant execute on function public.can_manage_project_events(uuid) to authenticated;

alter table public.project_events enable row level security;

drop policy if exists project_events_read on public.project_events;
create policy project_events_read on public.project_events
for select to authenticated
using (
  public.project_member_has_permission(project_id, auth.uid(), 'project.view')
  or exists (
    select 1 from public.project_members pm
    where pm.project_id = project_events.project_id and pm.user_id = auth.uid()
  )
  or public.can_manage_project_events(project_id)
);

drop policy if exists project_events_insert on public.project_events;
create policy project_events_insert on public.project_events
for insert to authenticated
with check (public.can_manage_project_events(project_id) and created_by = auth.uid());

drop policy if exists project_events_update on public.project_events;
create policy project_events_update on public.project_events
for update to authenticated
using (public.can_manage_project_events(project_id))
with check (public.can_manage_project_events(project_id));

drop policy if exists project_events_delete on public.project_events;
create policy project_events_delete on public.project_events
for delete to authenticated
using (public.can_manage_project_events(project_id));

grant select, insert, update, delete on public.project_events to authenticated;

-- Không cho chuyển sự kiện sang dự án khác hay đổi người tạo khi sửa.
create or replace function public.touch_project_event()
returns trigger language plpgsql set search_path = public as $$
begin
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists project_events_touch on public.project_events;
create trigger project_events_touch
before update on public.project_events
for each row execute function public.touch_project_event();

create or replace function public.notify_project_event_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  project_name text;
  label text;
begin
  select name into project_name from public.projects where id = new.project_id;
  label := case when new.type = 'meeting' then 'Lịch họp mới' else 'Nhắc nhở mới' end;

  insert into public.notifications (user_id, type, title, message, created_by)
  select distinct pm.user_id,
         'project_event',
         label || ': ' || new.title,
         coalesce(project_name, 'Dự án') || ' · '
           || to_char(new.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY')
           || coalesce(' · ' || nullif(trim(new.location), ''), ''),
         new.created_by
  from public.project_members pm
  join public.profiles p on p.id = pm.user_id and p.is_active
  where pm.project_id = new.project_id
    and pm.user_id is distinct from new.created_by;

  return new;
end;
$$;

drop trigger if exists project_events_notify on public.project_events;
create trigger project_events_notify
after insert on public.project_events
for each row execute function public.notify_project_event_created();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_events'
  ) then
    alter publication supabase_realtime add table public.project_events;
  end if;
end $$;

notify pgrst, 'reload schema';
