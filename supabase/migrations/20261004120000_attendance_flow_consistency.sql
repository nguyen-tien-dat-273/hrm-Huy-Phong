-- ============================================================================
-- Dong nhat luong cham cong: may/file -> checkout -> duyet -> khoa ky -> luong.
-- ============================================================================

-- 1. Ban ghi DEVICE chi co gio vao KHONG duoc tu dong duyet. Trigger dat ten
-- 00 de chay truoc guard duyet theo thu tu alphabet cua PostgreSQL.
create or replace function public.normalize_device_attendance_state()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  checkout_just_added boolean := false;
begin
  if tg_op = 'UPDATE' then
    checkout_just_added := old.check_out_time is null and new.check_out_time is not null;
  end if;
  if coalesce(new.check_in_method, '') = 'DEVICE' then
    new.status := 'completed';
    if new.check_out_time is null or checkout_just_added then
      new.approved_by_lead := false;
      new.approved_at := null;
      new.approved_by_user_id := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_00_device_state on public.attendance;
create trigger attendance_00_device_state
before insert or update on public.attendance
for each row execute function public.normalize_device_attendance_state();

-- Duyet ngay cong bat buoc phai co ca gio vao va gio ra, bat ke nguon nao.
create or replace function public.guard_attendance_approval()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  approval_started boolean := false;
begin
  if tg_op = 'INSERT' then
    approval_started := coalesce(new.approved_by_lead, false);
  elsif tg_op = 'UPDATE' then
    approval_started := new.approved_by_lead and not coalesce(old.approved_by_lead, false);
  end if;

  if approval_started
     and (new.status <> 'completed' or new.check_in_time is null or new.check_out_time is null) then
    raise exception 'Chi duoc duyet ngay cong da co du gio vao va gio ra.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Chua dong vao ky da khoa; ky dang mo thi dua du lieu cu ve dung trang thai.
update public.attendance
set approved_by_lead = false,
    approved_at = null,
    approved_by_user_id = null
where coalesce(check_in_method, '') = 'DEVICE'
  and check_out_time is null
  and not public.timesheet_period_locked(date);

-- 2. Lich su lo nhap file.
create table if not exists public.attendance_import_batches (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references public.attendance_devices(id) on delete set null,
  file_name text not null,
  received_rows integer not null default 0,
  accepted_rows integer not null default 0,
  skipped_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  imported_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.attendance_import_batches enable row level security;
drop policy if exists attendance_import_batches_admin on public.attendance_import_batches;
create policy attendance_import_batches_admin on public.attendance_import_batches
for select to authenticated using (public.is_admin() or public.can('attendance'));
grant select on public.attendance_import_batches to authenticated;

-- Mot RPC = mot transaction. Neu mot dong bi ky khoa/du lieu loi, toan bo lo
-- rollback, khong con tinh trang file duoc nhap nua chung.
create or replace function public.import_attendance_file(
  target_device uuid,
  source_file_name text,
  source_rows jsonb,
  received_count integer,
  skipped_count integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  work_item record;
  existing_row public.attendance%rowtype;
  inserted_count integer := 0;
  updated_count integer := 0;
  accepted_count integer := 0;
  batch_id uuid;
begin
  if not (public.is_admin() or public.can('attendance')) then
    raise exception 'Ban khong co quyen nhap file cham cong.' using errcode = '42501';
  end if;
  if jsonb_typeof(source_rows) <> 'array' then
    raise exception 'source_rows phai la mang JSON.' using errcode = '22023';
  end if;

  accepted_count := jsonb_array_length(source_rows);
  if accepted_count > 10000 then
    raise exception 'Moi file toi da 10000 dong hop le.' using errcode = '54000';
  end if;

  for work_item in
    select x.user_id, x.work_date, x.check_in_time
    from jsonb_to_recordset(source_rows) as x(
      user_id uuid,
      work_date date,
      check_in_time timestamptz
    )
  loop
    if work_item.user_id is null or work_item.work_date is null or work_item.check_in_time is null then
      raise exception 'Lo nhap co dong thieu user_id, work_date hoac check_in_time.' using errcode = '22023';
    end if;

    existing_row := null;
    select a.* into existing_row
    from public.attendance a
    where a.user_id = work_item.user_id and a.date = work_item.work_date
    order by a.check_in_time asc nulls last, a.created_at asc
    limit 1
    for update;

    if existing_row.id is null then
      insert into public.attendance(
        user_id, date, check_in_time, check_out_time, status,
        approved_by_lead, check_in_method, anomaly_flags
      ) values (
        work_item.user_id, work_item.work_date, work_item.check_in_time, null,
        'completed', false, 'DEVICE', '{}'
      );
      inserted_count := inserted_count + 1;
    elsif existing_row.check_in_time is null or work_item.check_in_time < existing_row.check_in_time then
      update public.attendance
      set check_in_time = work_item.check_in_time
      where id = existing_row.id;
      updated_count := updated_count + 1;
    end if;
  end loop;

  insert into public.attendance_import_batches(
    device_id, file_name, received_rows, accepted_rows, skipped_rows,
    inserted_rows, updated_rows, imported_by
  ) values (
    target_device, coalesce(nullif(trim(source_file_name), ''), 'attendance-file'),
    greatest(received_count, accepted_count), accepted_count, greatest(skipped_count, 0),
    inserted_count, updated_count, auth.uid()
  ) returning id into batch_id;

  return jsonb_build_object(
    'batch_id', batch_id,
    'accepted', accepted_count,
    'inserted', inserted_count,
    'updated', updated_count,
    'skipped', greatest(skipped_count, 0)
  );
end;
$$;

revoke all on function public.import_attendance_file(uuid, text, jsonb, integer, integer) from public;
grant execute on function public.import_attendance_file(uuid, text, jsonb, integer, integer) to authenticated;

-- 3. Cho phep ca qua dem (gio ra nho hon gio vao); chi cam hai gio trung nhau.
alter table public.work_schedules drop constraint if exists work_schedule_valid_hours;
alter table public.work_schedules
  add constraint work_schedule_valid_hours check (end_time <> start_time);

-- 4. Ly do tu choi la bat buoc de nhan vien biet can sua gi.
--
-- Phai drop truoc khi add: `add constraint` khong chay lai duoc, lan paste thu
-- hai se do o day va cac cau phia sau khong chay. Migration nay duoc dan tay
-- vao Supabase nen chay lai la chuyen binh thuong.
--
-- `not valid`: khong soi lai cac don da tu choi tu truoc. Siet nguoc ve qua
-- khu se lam ca migration do vi du lieu cu, trong khi muc dich chi la chan
-- don tu choi MOI khong co ly do.
alter table public.attendance_requests
  drop constraint if exists attendance_request_rejection_note_required;
alter table public.attendance_requests
  add constraint attendance_request_rejection_note_required
  check (status <> 'REJECTED' or length(trim(coalesce(review_note, ''))) >= 3) not valid;
