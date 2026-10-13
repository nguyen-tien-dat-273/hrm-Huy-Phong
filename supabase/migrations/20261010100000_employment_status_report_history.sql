-- Record employment transitions for management reports. Existing hire dates can
-- be backfilled; past termination dates cannot be inferred from current profiles.

create table if not exists public.employment_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('HIRED', 'STATUS_CHANGED', 'TERMINATED', 'REACTIVATED')),
  event_date date not null,
  previous_status text,
  new_status text not null,
  unit_id uuid,
  employee_name text not null,
  employee_code text,
  department text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists employment_status_events_date_unit_idx
  on public.employment_status_events(event_date, unit_id, event_type);

create index if not exists employment_status_events_user_date_idx
  on public.employment_status_events(user_id, event_date desc);

alter table public.employment_status_events enable row level security;

drop policy if exists employment_status_events_read on public.employment_status_events;
create policy employment_status_events_read
  on public.employment_status_events for select to authenticated
  using (public.can('reports') or public.can('users'));

revoke all on public.employment_status_events from public, anon, authenticated;
grant select on public.employment_status_events to authenticated;

create or replace function public.record_employment_status_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_kind text;
begin
  if tg_op = 'INSERT' then
    if new.hire_date is not null then
      insert into public.employment_status_events (
        user_id, event_type, event_date, new_status, unit_id,
        employee_name, employee_code, department, changed_by
      ) values (
        new.id, 'HIRED', new.hire_date, new.employment_status, new.unit_id,
        new.name, new.employee_code, new.department, auth.uid()
      );
    end if;
    return new;
  end if;

  if old.hire_date is null and new.hire_date is not null then
    insert into public.employment_status_events (
      user_id, event_type, event_date, previous_status, new_status, unit_id,
      employee_name, employee_code, department, changed_by
    ) values (
      new.id, 'HIRED', new.hire_date, old.employment_status, new.employment_status,
      new.unit_id, new.name, new.employee_code, new.department, auth.uid()
    );
  end if;

  if old.employment_status is distinct from new.employment_status then
    event_kind := case
      when new.employment_status = 'terminated' then 'TERMINATED'
      when old.employment_status = 'terminated' then 'REACTIVATED'
      else 'STATUS_CHANGED'
    end;

    insert into public.employment_status_events (
      user_id, event_type, event_date, previous_status, new_status, unit_id,
      employee_name, employee_code, department, changed_by
    ) values (
      new.id, event_kind, current_date, old.employment_status, new.employment_status,
      new.unit_id, new.name, new.employee_code, new.department, auth.uid()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_record_employment_status_event on public.profiles;
create trigger profiles_record_employment_status_event
  after insert on public.profiles
  for each row execute function public.record_employment_status_event();

drop trigger if exists profiles_update_employment_status_event on public.profiles;
create trigger profiles_update_employment_status_event
  after update of hire_date, employment_status on public.profiles
  for each row execute function public.record_employment_status_event();

-- Preserve known hire dates. No historical termination date is invented.
insert into public.employment_status_events (
  user_id, event_type, event_date, new_status, unit_id,
  employee_name, employee_code, department
)
select
  p.id, 'HIRED', p.hire_date, p.employment_status, p.unit_id,
  p.name, p.employee_code, p.department
from public.profiles p
where p.hire_date is not null
  and not exists (
    select 1
    from public.employment_status_events e
    where e.user_id = p.id and e.event_type = 'HIRED'
  );

create or replace view public.profiles_directory
with (security_barrier = true)
as
  select id, name, employee_code, department, unit_id, position_id,
         manager_id, role, is_active, avatar_url, employment_status, hire_date
  from public.profiles;

revoke all on public.profiles_directory from public, anon;
grant select on public.profiles_directory to authenticated;
