-- Validate project task deadlines and prevent duplicate assignee/deadline pairs
-- even when two users submit at the same time.
create or replace function public.validate_project_task_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  project_start date;
  project_end date;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.title is null or length(trim(new.title)) = 0 or length(new.title) > 200 then
    raise exception 'Tên nhiệm vụ phải có từ 1 đến 200 ký tự.' using errcode = '23514';
  end if;

  if new.due_date is null then
    raise exception 'Vui lòng chọn deadline cho nhiệm vụ.' using errcode = '23514';
  end if;

  select p.start_date, p.end_date into project_start, project_end
  from public.projects p
  where p.id = new.project_id;

  if not found then
    raise exception 'Không tìm thấy dự án.' using errcode = '23503';
  end if;

  if new.due_date < project_start or new.due_date > project_end then
    raise exception 'Deadline phải nằm trong thời gian của dự án.' using errcode = '23514';
  end if;

  if new.assignee_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      new.project_id::text || ':' || new.assignee_id::text || ':' || new.due_date::text,
      0
    ));

    if exists (
      select 1 from public.tasks t
      where t.project_id = new.project_id
        and t.assignee_id = new.assignee_id
        and t.due_date = new.due_date
    ) then
      raise exception 'Người thực hiện đã có nhiệm vụ khác cùng deadline trong dự án.' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists project_task_deadline_validation on public.tasks;
create trigger project_task_deadline_validation
before insert on public.tasks
for each row execute function public.validate_project_task_deadline();

revoke all on function public.validate_project_task_deadline() from public;
