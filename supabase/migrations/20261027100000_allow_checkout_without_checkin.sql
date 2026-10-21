-- ============================================================================
-- Cho phep check-out khi chua check-in (bo sung gio vao sau tu may cham cong)
-- ----------------------------------------------------------------------------
-- Quy tac:
-- 1. Nhan vien co the check-out tren HRM khi chua co gio vao (quen quet may
--    hoac may chua dong bo). Ban ghi tao voi check_in_time = null va check_out_time != null.
-- 2. Ngay chi co gio ra (thieu gio vao) CHUA duoc tinh cong (approved_by_lead = false).
-- 3. Khi may cham cong dong bo hoac admin nhap file vao cuoi thang, gio vao
--    duoc bo sung va ngay cong tu dong duoc duyet khi da co du ca hai gio.
-- ============================================================================

create or replace function public.normalize_device_attendance_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.check_in_method, '') <> 'DEVICE' then
    return new;
  end if;

  -- Ghi nhan trang thai completed cho ca ngay cong tu thiet bi
  new.status := 'completed';

  if new.check_out_time is null or new.check_in_time is null then
    -- Thieu gio vao hoac thieu gio ra thi chua du de tinh cong
    new.approved_by_lead := false;
    new.approved_at := null;
    new.approved_by_user_id := null;
  elsif not coalesce(new.approved_by_lead, false) then
    -- Du ca hai moc gio: tinh cong ngay, khong can ai duyet tay
    new.approved_by_lead := true;
    new.approved_at := coalesce(new.approved_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_00_device_state on public.attendance;
create trigger attendance_00_device_state
before insert or update on public.attendance
for each row execute function public.normalize_device_attendance_state();

comment on function public.normalize_device_attendance_state() is
  'Ngay cong DEVICE: chi tu dong approved khi co DU CA HAI gio vao va gio ra. Thieu mot trong hai thi de chua tinh cong.';

-- Cap nhat ham import file cham cong de khi bo sung gio vao cho dong da checkout,
-- nguon chuyen ve DEVICE va tu dong kich hoat trigger tinh cong
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
      set check_in_time = work_item.check_in_time,
          check_in_method = 'DEVICE'
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
