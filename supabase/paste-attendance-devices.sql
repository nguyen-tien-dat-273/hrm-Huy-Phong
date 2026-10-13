-- ============================================================================
-- MAY CHAM CONG - dan ca file nay vao Supabase > SQL Editor > Run.
-- ----------------------------------------------------------------------------
-- Ba migration duoi day gop lai, da chuyen het comment sang ASCII de dan khong
-- loi encoding:
--
--   supabase/migrations/20260926100000_attendance_devices.sql
--   supabase/migrations/20260927130000_attendance_device_autoapprove.sql
--   supabase/migrations/20260930230000_attendance_device_arrival_only.sql
--
-- Sau khi chay file nay, tiep tuc chay migration
-- 20261007113000_security_payroll_attendance_hardening.sql. Neu chay lai file
-- nay sau do, phai chay lai migration hardening de khoi phuc han token va log auth.
--
-- Thu tu quan trong - phan sau thay than ham cua phan truoc:
--
--   Thieu phan 2: ngay cong tu may mac o approved_by_lead = false, bang luong
--   ra ~0 ngay cong ma khong bao loi.
--
--   Thieu phan 3: 93% ngay o may nay chi co MOT lan cham, khong co gio ra.
--   Guard `guard_attendance_approval` chan duyet khi thieu gio ra, nen moi loi
--   goi dong bo se VANG EXCEPTION - bridge khong chay duoc lan nao.
--
-- Chay lai nhieu lan duoc: moi cau lenh deu la if not exists / or replace /
-- drop if exists truoc khi tao.
--
-- Chay xong kiem chung bang: supabase/check_migrations.sql
-- ============================================================================


-- >>> 20260926100000_attendance_devices.sql
-- Bang thiet bi, anh xa nhan vien, token bridge, log tho, va RPC nap su kien.

-- Tich hop may cham cong Ronald Jack / ZKTeco qua mot bridge trong mang LAN.
-- Website khong ket noi truc tiep toi IP noi bo; bridge day log vao RPC bao mat nay.

create extension if not exists pgcrypto;

create table if not exists public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  model text,
  serial_number text,
  location_id uuid references public.work_locations(id) on delete set null,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  is_active boolean not null default true,
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status is null or last_sync_status in ('SUCCESS', 'PARTIAL', 'ERROR')),
  last_sync_message text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists attendance_devices_serial_unique
  on public.attendance_devices(lower(serial_number)) where serial_number is not null;

create table if not exists public.attendance_device_mappings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  device_user_id text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(device_id, device_user_id),
  unique(device_id, profile_id)
);

create table if not exists public.attendance_device_tokens (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  label text not null default 'Bridge',
  token_hash text not null unique,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_device_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  external_id text not null,
  device_user_id text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  punched_at timestamptz not null,
  punch_type text not null default 'AUTO' check (punch_type in ('AUTO', 'IN', 'OUT', 'BREAK_OUT', 'BREAK_IN')),
  verify_mode text,
  raw_payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz not null default now(),
  unique(device_id, external_id)
);

create index if not exists attendance_device_events_lookup_idx
  on public.attendance_device_events(device_id, device_user_id, punched_at);
create index if not exists attendance_device_events_unprocessed_idx
  on public.attendance_device_events(device_id, received_at) where processed_at is null;

create table if not exists public.attendance_device_sync_runs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCESS', 'PARTIAL', 'ERROR')),
  received_count integer not null default 0,
  inserted_count integer not null default 0,
  processed_count integer not null default 0,
  unmapped_count integer not null default 0,
  message text
);

alter table public.attendance_devices enable row level security;
alter table public.attendance_device_mappings enable row level security;
alter table public.attendance_device_tokens enable row level security;
alter table public.attendance_device_events enable row level security;
alter table public.attendance_device_sync_runs enable row level security;

drop policy if exists attendance_devices_admin on public.attendance_devices;
create policy attendance_devices_admin on public.attendance_devices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists attendance_device_mappings_admin on public.attendance_device_mappings;
create policy attendance_device_mappings_admin on public.attendance_device_mappings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists attendance_device_events_admin on public.attendance_device_events;
create policy attendance_device_events_admin on public.attendance_device_events
  for select to authenticated using (public.is_admin());
drop policy if exists attendance_device_sync_runs_admin on public.attendance_device_sync_runs;
create policy attendance_device_sync_runs_admin on public.attendance_device_sync_runs
  for select to authenticated using (public.is_admin());

grant select, insert, update, delete on public.attendance_devices to authenticated;
grant select, insert, update, delete on public.attendance_device_mappings to authenticated;
grant select on public.attendance_device_events, public.attendance_device_sync_runs to authenticated;
-- Token khong bao gio duoc doc truc tiep; chi RPC tao token tra plaintext mot lan.
revoke all on public.attendance_device_tokens from anon, authenticated;

-- Bo sung nguon DEVICE vao constraint cu ma khong phu thuoc ten constraint.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'attendance' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%check_in_method%'
  loop
    execute format('alter table public.attendance drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.attendance
  add constraint attendance_check_in_method_valid
  check (check_in_method is null or check_in_method in ('GPS', 'WIFI', 'MANUAL', 'DEVICE'));

-- May vat ly da duoc gan voi dia diem; khong ap dung yeu cau toa do GPS cua trinh duyet.
drop trigger if exists attendance_geofence_guard on public.attendance;
create trigger attendance_geofence_guard
before insert or update of check_in_time, check_in_latitude, check_in_longitude,
  gps_accuracy_meters, gps_captured_at on public.attendance
for each row when (new.check_in_method is distinct from 'DEVICE')
execute function public.guard_attendance_geofence();

create or replace function public.issue_attendance_device_token(
  target_device uuid,
  token_label text default 'Bridge'
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  plain_token text;
begin
  if not public.is_admin() then
    raise exception 'Chi Admin/CEO duoc tao khoa dong bo.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.attendance_devices where id = target_device and is_active) then
    raise exception 'May cham cong khong ton tai hoac da tat.' using errcode = '22023';
  end if;

  plain_token := 'rj_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.attendance_device_tokens(device_id, label, token_hash)
  values (target_device, coalesce(nullif(trim(token_label), ''), 'Bridge'), encode(digest(plain_token, 'sha256'), 'hex'));
  return plain_token;
end;
$$;

create or replace function public.revoke_attendance_device_tokens(target_device uuid)
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare affected integer;
begin
  if not public.is_admin() then
    raise exception 'Chi Admin/CEO duoc thu hoi khoa dong bo.' using errcode = '42501';
  end if;
  update public.attendance_device_tokens set revoked_at = now()
  where device_id = target_device and revoked_at is null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.issue_attendance_device_token(uuid, text) from public;
revoke all on function public.revoke_attendance_device_tokens(uuid) from public;
grant execute on function public.issue_attendance_device_token(uuid, text) to authenticated;
grant execute on function public.revoke_attendance_device_tokens(uuid) to authenticated;

create or replace function public.ingest_attendance_device_events(
  bridge_token text,
  events jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  selected_token public.attendance_device_tokens%rowtype;
  selected_device public.attendance_devices%rowtype;
  sync_id uuid;
  received_count integer := 0;
  inserted_count integer := 0;
  processed_count integer := 0;
  unmapped_count integer := 0;
  work_item record;
  existing_attendance public.attendance%rowtype;
  first_punch timestamptz;
  last_punch timestamptz;
  explicit_out timestamptz;
  event_count integer;
  local_date date;
begin
  if bridge_token is null or length(bridge_token) < 20 then
    raise exception 'Khoa bridge khong hop le.' using errcode = '28000';
  end if;
  if jsonb_typeof(events) <> 'array' then
    raise exception 'events phai la JSON array.' using errcode = '22023';
  end if;

  select t.* into selected_token
  from public.attendance_device_tokens t
  join public.attendance_devices d on d.id = t.device_id
  where t.token_hash = encode(digest(bridge_token, 'sha256'), 'hex')
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
    and d.is_active
  limit 1;
  if selected_token.id is null then
    raise exception 'Khoa bridge sai, het han hoac da bi thu hoi.' using errcode = '28000';
  end if;
  select * into selected_device from public.attendance_devices where id = selected_token.device_id;

  received_count := jsonb_array_length(events);
  if received_count > 5000 then
    raise exception 'Moi lan dong bo toi da 5000 su kien.' using errcode = '54000';
  end if;
  insert into public.attendance_device_sync_runs(device_id, received_count)
  values (selected_device.id, received_count) returning id into sync_id;

  with payload as (
    select * from jsonb_to_recordset(events) as item(
      external_id text, device_user_id text, punched_at timestamptz,
      punch_type text, verify_mode text, raw_payload jsonb
    )
  ), inserted as (
    insert into public.attendance_device_events(
      device_id, external_id, device_user_id, punched_at, punch_type, verify_mode, raw_payload
    )
    select selected_device.id,
      trim(p.external_id), trim(p.device_user_id), p.punched_at,
      case when upper(coalesce(p.punch_type, 'AUTO')) in ('AUTO','IN','OUT','BREAK_OUT','BREAK_IN')
        then upper(coalesce(p.punch_type, 'AUTO')) else 'AUTO' end,
      nullif(trim(p.verify_mode), ''), coalesce(p.raw_payload, '{}'::jsonb)
    from payload p
    where nullif(trim(p.external_id), '') is not null
      and nullif(trim(p.device_user_id), '') is not null
      and p.punched_at is not null
    on conflict (device_id, external_id) do nothing
    returning id
  ) select count(*) into inserted_count from inserted;

  -- Mapping khai bao uu tien; neu chua co thi thu dung employee_code trung ma tren may.
  update public.attendance_device_events e
  set profile_id = coalesce(m.profile_id, p.id),
      processing_error = case when coalesce(m.profile_id, p.id) is null then 'UNMAPPED_USER' else null end
  from (select e2.id, e2.device_user_id from public.attendance_device_events e2
        where e2.device_id = selected_device.id and e2.processed_at is null) pending
  left join public.attendance_device_mappings m
    on m.device_id = selected_device.id and m.device_user_id = pending.device_user_id
  left join public.profiles p
    on lower(p.employee_code) = lower(pending.device_user_id) and p.is_active
  where e.id = pending.id;

  select count(*) into unmapped_count
  from public.attendance_device_events
  where device_id = selected_device.id and processed_at is null and profile_id is null;

  for work_item in
    select distinct e.profile_id,
      (e.punched_at at time zone selected_device.timezone)::date as work_date
    from public.attendance_device_events e
    where e.device_id = selected_device.id and e.processed_at is null and e.profile_id is not null
  loop
    local_date := work_item.work_date;
    select min(e.punched_at), max(e.punched_at),
      max(e.punched_at) filter (where e.punch_type in ('OUT', 'BREAK_OUT')),
      count(*)
    into first_punch, last_punch, explicit_out, event_count
    from public.attendance_device_events e
    where e.device_id = selected_device.id and e.profile_id = work_item.profile_id
      and (e.punched_at at time zone selected_device.timezone)::date = local_date;

    select * into existing_attendance
    from public.attendance a
    where a.user_id = work_item.profile_id and a.date = local_date
    for update;

    if existing_attendance.id is null then
      insert into public.attendance(
        user_id, date, check_in_time, check_out_time, status, approved_by_lead,
        location_id, check_in_method, anomaly_flags
      ) values (
        work_item.profile_id, local_date, first_punch,
        case when explicit_out is not null then explicit_out
             when event_count >= 2 and last_punch > first_punch then last_punch else null end,
        case when explicit_out is not null or (event_count >= 2 and last_punch > first_punch)
             then 'completed' else 'active' end,
        false, selected_device.location_id, 'DEVICE', '{}'
      );
    elsif coalesce(existing_attendance.check_in_method, 'DEVICE') = 'DEVICE' then
      update public.attendance
      set check_in_time = least(coalesce(check_in_time, first_punch), first_punch),
          check_out_time = case
            when explicit_out is not null then greatest(coalesce(check_out_time, explicit_out), explicit_out)
            when event_count >= 2 and last_punch > first_punch then greatest(coalesce(check_out_time, last_punch), last_punch)
            else check_out_time end,
          status = case when explicit_out is not null or (event_count >= 2 and last_punch > first_punch)
            then 'completed' else status end,
          location_id = coalesce(location_id, selected_device.location_id),
          check_in_method = 'DEVICE'
      where id = existing_attendance.id;
    elsif (explicit_out is not null or event_count >= 2) and last_punch > existing_attendance.check_in_time then
      -- Neu nhan vien check-in bang GPS, may vat ly co the bo sung checkout.
      update public.attendance
      set check_out_time = greatest(coalesce(check_out_time, last_punch), last_punch), status = 'completed'
      where id = existing_attendance.id;
    end if;

    update public.attendance_device_events
    set processed_at = now(), processing_error = null
    where device_id = selected_device.id and profile_id = work_item.profile_id
      and (punched_at at time zone selected_device.timezone)::date = local_date
      and processed_at is null;
    get diagnostics processed_count = row_count;
  end loop;

  -- processed_count phai la tong, tinh lai de tranh gia tri cua vong lap cuoi.
  select count(*) into processed_count from public.attendance_device_events
  where device_id = selected_device.id and received_at >= (select started_at from public.attendance_device_sync_runs where id = sync_id)
    and processed_at is not null;

  update public.attendance_device_tokens set last_used_at = now() where id = selected_token.id;
  update public.attendance_devices
  set last_seen_at = now(), last_sync_at = now(),
      last_sync_status = case when unmapped_count > 0 then 'PARTIAL' else 'SUCCESS' end,
      last_sync_message = case when unmapped_count > 0
        then unmapped_count || ' ma nhan vien chua duoc anh xa.' else inserted_count || ' su kien moi.' end,
      updated_at = now()
  where id = selected_device.id;
  update public.attendance_device_sync_runs
  set finished_at = now(), status = case when unmapped_count > 0 then 'PARTIAL' else 'SUCCESS' end,
      inserted_count = ingest_attendance_device_events.inserted_count,
      processed_count = ingest_attendance_device_events.processed_count,
      unmapped_count = ingest_attendance_device_events.unmapped_count,
      message = case when unmapped_count > 0 then 'Co ma nhan vien chua anh xa.' else 'Dong bo thanh cong.' end
  where id = sync_id;

  return jsonb_build_object(
    'sync_id', sync_id, 'received', received_count, 'inserted', inserted_count,
    'processed', processed_count, 'unmapped', unmapped_count,
    'status', case when unmapped_count > 0 then 'PARTIAL' else 'SUCCESS' end
  );
exception when others then
  if sync_id is not null then
    update public.attendance_device_sync_runs
    set finished_at = now(), status = 'ERROR', message = sqlerrm where id = sync_id;
    update public.attendance_devices
    set last_sync_at = now(), last_sync_status = 'ERROR', last_sync_message = sqlerrm, updated_at = now()
    where id = selected_device.id;
  end if;
  raise;
end;
$$;

revoke all on function public.ingest_attendance_device_events(text, jsonb) from public;
grant execute on function public.ingest_attendance_device_events(text, jsonb) to anon, authenticated;


-- >>> 20260927130000_attendance_device_autoapprove.sql
-- Cham cong tu may tu dong duyet, khong cho nguoi duyet tay.

-- ============================================================================
-- Tu dong duyet cham cong den tu may cham cong vat ly.
-- ----------------------------------------------------------------------------
-- Quyet dinh nghiep vu: du lieu cham cong toi day chi con lay tu may cham
-- cong (van tay/khuon mat), khong dung luong GPS/tu khai cua nhan vien nua -
-- theo do man "Duyet cham cong" (/admin/attendance) bi bo khoi menu/route.
--
-- NHUNG: `ingest_attendance_device_events()` (migration 20260926100000) dang
-- ghi `approved_by_lead = false` cho MOI ban ghi lay tu may - ban ghi do van
-- can mot nguoi vao dung man "Duyet cham cong" bam duyet tay thi
-- `payrollData.ts` moi dem ngay cong do vao luong (`.eq('approved_by_lead',
-- true)`). Bo man duyet ma khong sua ham nay thi KHONG CON CACH NAO dat co do
-- thanh true nua - luong cua TAT CA moi nguoi se vinh vien tinh ra ~0 ngay
-- cong ma khong co loi hay canh bao nao hien ra, vi ve mat ky thuat cau truy
-- van van chay dung, chi la khong con du lieu nao thoa dieu kien.
--
-- Sua: du lieu do CHINH may cham cong ghi (check_in_method = 'DEVICE') coi la
-- da xac thuc du tin cay (da qua van tay/khuon mat tai may) - tu dong
-- `approved_by_lead = true`, khong can nguoi duyet tay nua. Ap dung cho ca
-- nhanh tao moi (dong cong dau tien trong ngay) lan nhanh cap nhat (may gui
-- them su kien check-out sau).
--
-- Toan bo phan con lai cua ham giu NGUYEN VEN so voi ban goc - chi doi dung 2
-- cho lien quan approved_by_lead, khong doi logic anh xa nhan vien/gop gio.
-- ============================================================================

create or replace function public.ingest_attendance_device_events(
  bridge_token text,
  events jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  selected_token public.attendance_device_tokens%rowtype;
  selected_device public.attendance_devices%rowtype;
  sync_id uuid;
  received_count integer := 0;
  inserted_count integer := 0;
  processed_count integer := 0;
  unmapped_count integer := 0;
  work_item record;
  existing_attendance public.attendance%rowtype;
  first_punch timestamptz;
  last_punch timestamptz;
  explicit_out timestamptz;
  event_count integer;
  local_date date;
begin
  if bridge_token is null or length(bridge_token) < 20 then
    raise exception 'Khoa bridge khong hop le.' using errcode = '28000';
  end if;
  if jsonb_typeof(events) <> 'array' then
    raise exception 'events phai la JSON array.' using errcode = '22023';
  end if;

  select t.* into selected_token
  from public.attendance_device_tokens t
  join public.attendance_devices d on d.id = t.device_id
  where t.token_hash = encode(digest(bridge_token, 'sha256'), 'hex')
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
    and d.is_active
  limit 1;
  if selected_token.id is null then
    raise exception 'Khoa bridge sai, het han hoac da bi thu hoi.' using errcode = '28000';
  end if;
  select * into selected_device from public.attendance_devices where id = selected_token.device_id;

  received_count := jsonb_array_length(events);
  if received_count > 5000 then
    raise exception 'Moi lan dong bo toi da 5000 su kien.' using errcode = '54000';
  end if;
  insert into public.attendance_device_sync_runs(device_id, received_count)
  values (selected_device.id, received_count) returning id into sync_id;

  with payload as (
    select * from jsonb_to_recordset(events) as item(
      external_id text, device_user_id text, punched_at timestamptz,
      punch_type text, verify_mode text, raw_payload jsonb
    )
  ), inserted as (
    insert into public.attendance_device_events(
      device_id, external_id, device_user_id, punched_at, punch_type, verify_mode, raw_payload
    )
    select selected_device.id,
      trim(p.external_id), trim(p.device_user_id), p.punched_at,
      case when upper(coalesce(p.punch_type, 'AUTO')) in ('AUTO','IN','OUT','BREAK_OUT','BREAK_IN')
        then upper(coalesce(p.punch_type, 'AUTO')) else 'AUTO' end,
      nullif(trim(p.verify_mode), ''), coalesce(p.raw_payload, '{}'::jsonb)
    from payload p
    where nullif(trim(p.external_id), '') is not null
      and nullif(trim(p.device_user_id), '') is not null
      and p.punched_at is not null
    on conflict (device_id, external_id) do nothing
    returning id
  ) select count(*) into inserted_count from inserted;

  -- Mapping khai bao uu tien; neu chua co thi thu dung employee_code trung ma tren may.
  update public.attendance_device_events e
  set profile_id = coalesce(m.profile_id, p.id),
      processing_error = case when coalesce(m.profile_id, p.id) is null then 'UNMAPPED_USER' else null end
  from (select e2.id, e2.device_user_id from public.attendance_device_events e2
        where e2.device_id = selected_device.id and e2.processed_at is null) pending
  left join public.attendance_device_mappings m
    on m.device_id = selected_device.id and m.device_user_id = pending.device_user_id
  left join public.profiles p
    on lower(p.employee_code) = lower(pending.device_user_id) and p.is_active
  where e.id = pending.id;

  select count(*) into unmapped_count
  from public.attendance_device_events
  where device_id = selected_device.id and processed_at is null and profile_id is null;

  for work_item in
    select distinct e.profile_id,
      (e.punched_at at time zone selected_device.timezone)::date as work_date
    from public.attendance_device_events e
    where e.device_id = selected_device.id and e.processed_at is null and e.profile_id is not null
  loop
    local_date := work_item.work_date;
    select min(e.punched_at), max(e.punched_at),
      max(e.punched_at) filter (where e.punch_type in ('OUT', 'BREAK_OUT')),
      count(*)
    into first_punch, last_punch, explicit_out, event_count
    from public.attendance_device_events e
    where e.device_id = selected_device.id and e.profile_id = work_item.profile_id
      and (e.punched_at at time zone selected_device.timezone)::date = local_date;

    select * into existing_attendance
    from public.attendance a
    where a.user_id = work_item.profile_id and a.date = local_date
    for update;

    if existing_attendance.id is null then
      insert into public.attendance(
        user_id, date, check_in_time, check_out_time, status, approved_by_lead,
        location_id, check_in_method, anomaly_flags
      ) values (
        work_item.profile_id, local_date, first_punch,
        case when explicit_out is not null then explicit_out
             when event_count >= 2 and last_punch > first_punch then last_punch else null end,
        case when explicit_out is not null or (event_count >= 2 and last_punch > first_punch)
             then 'completed' else 'active' end,
        -- Da sua: true - du lieu tu may cham cong khong can duyet tay nua.
        true, selected_device.location_id, 'DEVICE', '{}'
      );
    elsif coalesce(existing_attendance.check_in_method, 'DEVICE') = 'DEVICE' then
      update public.attendance
      set check_in_time = least(coalesce(check_in_time, first_punch), first_punch),
          check_out_time = case
            when explicit_out is not null then greatest(coalesce(check_out_time, explicit_out), explicit_out)
            when event_count >= 2 and last_punch > first_punch then greatest(coalesce(check_out_time, last_punch), last_punch)
            else check_out_time end,
          status = case when explicit_out is not null or (event_count >= 2 and last_punch > first_punch)
            then 'completed' else status end,
          location_id = coalesce(location_id, selected_device.location_id),
          check_in_method = 'DEVICE',
          -- Da sua: du lieu may cap nhat them (vd check-out) cung tu duyet.
          approved_by_lead = true
      where id = existing_attendance.id;
    elsif (explicit_out is not null or event_count >= 2) and last_punch > existing_attendance.check_in_time then
      -- Neu nhan vien check-in bang GPS, may vat ly co the bo sung checkout.
      update public.attendance
      set check_out_time = greatest(coalesce(check_out_time, last_punch), last_punch), status = 'completed'
      where id = existing_attendance.id;
    end if;

    update public.attendance_device_events
    set processed_at = now(), processing_error = null
    where device_id = selected_device.id and profile_id = work_item.profile_id
      and (punched_at at time zone selected_device.timezone)::date = local_date
      and processed_at is null;
    get diagnostics processed_count = row_count;
  end loop;

  -- processed_count phai la tong, tinh lai de tranh gia tri cua vong lap cuoi.
  select count(*) into processed_count from public.attendance_device_events
  where device_id = selected_device.id and received_at >= (select started_at from public.attendance_device_sync_runs where id = sync_id)
    and processed_at is not null;

  update public.attendance_device_tokens set last_used_at = now() where id = selected_token.id;
  update public.attendance_devices
  set last_seen_at = now(), last_sync_at = now(),
      last_sync_status = case when unmapped_count > 0 then 'PARTIAL' else 'SUCCESS' end,
      last_sync_message = case when unmapped_count > 0
        then unmapped_count || ' ma nhan vien chua duoc anh xa.' else inserted_count || ' su kien moi.' end,
      updated_at = now()
  where id = selected_device.id;
  update public.attendance_device_sync_runs
  set finished_at = now(), status = case when unmapped_count > 0 then 'PARTIAL' else 'SUCCESS' end,
      inserted_count = ingest_attendance_device_events.inserted_count,
      processed_count = ingest_attendance_device_events.processed_count,
      unmapped_count = ingest_attendance_device_events.unmapped_count,
      message = case when unmapped_count > 0 then 'Co ma nhan vien chua anh xa.' else 'Dong bo thanh cong.' end
  where id = sync_id;

  return jsonb_build_object(
    'sync_id', sync_id, 'received', received_count, 'inserted', inserted_count,
    'processed', processed_count, 'unmapped', unmapped_count,
    'status', case when unmapped_count > 0 then 'PARTIAL' else 'SUCCESS' end
  );
exception when others then
  if sync_id is not null then
    update public.attendance_device_sync_runs
    set finished_at = now(), status = 'ERROR', message = sqlerrm where id = sync_id;
    update public.attendance_devices
    set last_sync_at = now(), last_sync_status = 'ERROR', last_sync_message = sqlerrm, updated_at = now()
    where id = selected_device.id;
  end if;
  raise;
end;
$$;

revoke all on function public.ingest_attendance_device_events(text, jsonb) from public;
grant execute on function public.ingest_attendance_device_events(text, jsonb) to anon, authenticated;

-- Hoi to: cac ban ghi CU da lay tu may cham cong (check_in_method = 'DEVICE')
-- truoc migration nay, dang ket o approved_by_lead = false vi man duyet sap
-- bi xoa - duyet luon cho khoi mat cong du lieu thang da qua.
update public.attendance
set approved_by_lead = true
where check_in_method = 'DEVICE' and approved_by_lead = false;


-- >>> 20260930230000_attendance_device_arrival_only.sql
-- May chi ghi gio vao: mot lan quet = mot ngay cong, check_out_time de NULL.

-- ============================================================================
-- May cham cong chi ghi GIO VAO: mo hinh lai cho dung thuc te.
-- ----------------------------------------------------------------------------
-- Do tren may that (ZMM510_TFT, serial 1313245000324, 7262 ban ghi tu
-- 2025-06-03 den 2026-09-30):
--
--   93% cap nguoi-ngay chi co DUNG MOT lan cham (6221/6725).
--   93% ban ghi roi vao khung 07h-08h; ca ngay gan nhu khong co lan cham chieu.
--   Trong 504 cap co >=2 lan, 65% cach nhau DUOI 1 gio - do quet lai, khong
--   phai ve som.
--   Truong status chi co hai gia tri 1 va 15, ca hai deu xuat hien luc 7-8h
--   sang, nen KHONG cai nao la co "ra ve". verifyMode = 255 o moi ban ghi,
--   tuc may khong bao che do xac thuc.
--
-- Ket luan: nhan vien chi quet luc den. May nay khong co du lieu gio ra.
--
-- Vi sao phai sua SQL chu khong chi chinh RJ_IN/OUT_STATUS_CODES:
--
--   `guard_attendance_approval` (migration 20260908190000) chan
--   `approved_by_lead = true` khi `check_out_time is null`. Migration
--   20260927130000 lai dat `approved_by_lead = true` cho MOI ban ghi tu may.
--   Hai cai nay cong lai: ngay chi co mot lan cham se lam ca loi goi
--   `ingest_attendance_device_events()` VANG EXCEPTION, dong bo hong hoan
--   toan chu khong phai hong mot dong. Voi 93% ngay nhu vay thi bridge khong
--   bao gio chay duoc lan nao.
--
--   Cach lach bang cach khai ca hai ma status la "ra ve" thi qua duoc guard,
--   nhung khi do `check_out_time` bi dat bang dung `check_in_time`. Do la so
--   lieu BIA: bao cao se noi moi nguoi lam 0 gio moi ngay. Te hon, ham
--   `computePeriodStats` (client/src/lib/payroll.ts) co nhanh du phong
--   `workHours > 0 ? workHours : workDays * hoursPerDay` - chi can MOT ngay
--   trong thang co khoang cach that la workHours > 0, va tong gio cong ca
--   thang tut xuong con dung ngay hom do. Khoan luong tinh theo gio se tra
--   thieu nghiem trong ma khong bao loi.
--
-- Cach sua o day: coi mot lan quet la mot ngay cong hoan chinh, va de
-- `check_out_time` NULL dung nhu thuc te. Khi do workHours = 0, nhanh du phong
-- `workDays * hoursPerDay` chay dung nhu thiet ke, khong con bay.
--
-- Co mot co tren tung thiet bi de quay lai hanh vi cu, cho may nao that su co
-- cham gio ra.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Co khai bao may co ghi gio ra hay khong.
-- ---------------------------------------------------------------------------
alter table public.attendance_devices
  add column if not exists records_checkout boolean not null default false;

comment on column public.attendance_devices.records_checkout is
  'false (mac dinh): may chi ghi gio vao - moi lan quet la mot ngay cong, check_out_time de NULL. true: may co cham gio ra - giu cach gop lan dau/lan cuoi.';

-- ---------------------------------------------------------------------------
-- 2. Noi guard duyet cong cho rieng nguon DEVICE.
-- ---------------------------------------------------------------------------
-- Guard goc doi moi ban ghi duoc duyet phai co gio check-out. Dung cho luong
-- nhan vien tu khai: khong co gio ra thi khong biet lam bao lau. Nhung du lieu
-- tu may vat ly da qua van tay/khuon mat, va may nay khong bao gio gui gio ra -
-- doi dieu kien do o day dong nghia khong bao gio duyet duoc ngay nao.
--
-- Chi noi dung cho check_in_method = 'DEVICE'. Luong GPS/tu khai giu nguyen
-- rang buoc cu.
create or replace function public.guard_attendance_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.approved_by_lead
     and (not coalesce(old.approved_by_lead, false) or tg_op = 'INSERT')
     and (new.status <> 'completed'
          or (new.check_out_time is null
              and coalesce(new.check_in_method, '') <> 'DEVICE')) then
    raise exception 'Chi duoc duyet ngay cong da hoan tat va co gio check-out.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_approval_guard on public.attendance;
create trigger attendance_approval_guard
before insert or update on public.attendance
for each row execute function public.guard_attendance_approval();

-- ---------------------------------------------------------------------------
-- 3. Thay than ham nap su kien.
-- ---------------------------------------------------------------------------
-- Chi doi phan quyet ra ngay cong (khoi insert/update vao bang attendance).
-- Phan xac thuc token, chong trung external_id, anh xa nhan vien giu NGUYEN VEN
-- so voi 20260927130000.
create or replace function public.ingest_attendance_device_events(
  bridge_token text,
  events jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  selected_token public.attendance_device_tokens%rowtype;
  selected_device public.attendance_devices%rowtype;
  sync_id uuid;
  received_count integer := 0;
  inserted_count integer := 0;
  processed_count integer := 0;
  unmapped_count integer := 0;
  work_item record;
  existing_attendance public.attendance%rowtype;
  first_punch timestamptz;
  last_punch timestamptz;
  explicit_out timestamptz;
  event_count integer;
  local_date date;
  resolved_out timestamptz;
  resolved_status text;
begin
  if bridge_token is null or length(bridge_token) < 20 then
    raise exception 'Khoa bridge khong hop le.' using errcode = '28000';
  end if;
  if jsonb_typeof(events) <> 'array' then
    raise exception 'events phai la JSON array.' using errcode = '22023';
  end if;

  select t.* into selected_token
  from public.attendance_device_tokens t
  join public.attendance_devices d on d.id = t.device_id
  where t.token_hash = encode(digest(bridge_token, 'sha256'), 'hex')
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
    and d.is_active
  limit 1;
  if selected_token.id is null then
    raise exception 'Khoa bridge sai, het han hoac da bi thu hoi.' using errcode = '28000';
  end if;
  select * into selected_device from public.attendance_devices where id = selected_token.device_id;

  received_count := jsonb_array_length(events);
  if received_count > 5000 then
    raise exception 'Moi lan dong bo toi da 5000 su kien.' using errcode = '54000';
  end if;
  insert into public.attendance_device_sync_runs(device_id, received_count)
  values (selected_device.id, received_count) returning id into sync_id;

  with payload as (
    select * from jsonb_to_recordset(events) as item(
      external_id text, device_user_id text, punched_at timestamptz,
      punch_type text, verify_mode text, raw_payload jsonb
    )
  ), inserted as (
    insert into public.attendance_device_events(
      device_id, external_id, device_user_id, punched_at, punch_type, verify_mode, raw_payload
    )
    select selected_device.id,
      trim(p.external_id), trim(p.device_user_id), p.punched_at,
      case when upper(coalesce(p.punch_type, 'AUTO')) in ('AUTO','IN','OUT','BREAK_OUT','BREAK_IN')
        then upper(coalesce(p.punch_type, 'AUTO')) else 'AUTO' end,
      nullif(trim(p.verify_mode), ''), coalesce(p.raw_payload, '{}'::jsonb)
    from payload p
    where nullif(trim(p.external_id), '') is not null
      and nullif(trim(p.device_user_id), '') is not null
      and p.punched_at is not null
    on conflict (device_id, external_id) do nothing
    returning id
  ) select count(*) into inserted_count from inserted;

  -- Mapping khai bao uu tien; neu chua co thi thu dung employee_code trung ma tren may.
  update public.attendance_device_events e
  set profile_id = coalesce(m.profile_id, p.id),
      processing_error = case when coalesce(m.profile_id, p.id) is null then 'UNMAPPED_USER' else null end
  from (select e2.id, e2.device_user_id from public.attendance_device_events e2
        where e2.device_id = selected_device.id and e2.processed_at is null) pending
  left join public.attendance_device_mappings m
    on m.device_id = selected_device.id and m.device_user_id = pending.device_user_id
  left join public.profiles p
    on lower(p.employee_code) = lower(pending.device_user_id) and p.is_active
  where e.id = pending.id;

  select count(*) into unmapped_count
  from public.attendance_device_events
  where device_id = selected_device.id and processed_at is null and profile_id is null;

  for work_item in
    select distinct e.profile_id,
      (e.punched_at at time zone selected_device.timezone)::date as work_date
    from public.attendance_device_events e
    where e.device_id = selected_device.id and e.processed_at is null and e.profile_id is not null
  loop
    local_date := work_item.work_date;
    select min(e.punched_at), max(e.punched_at),
      max(e.punched_at) filter (where e.punch_type in ('OUT', 'BREAK_OUT')),
      count(*)
    into first_punch, last_punch, explicit_out, event_count
    from public.attendance_device_events e
    where e.device_id = selected_device.id and e.profile_id = work_item.profile_id
      and (e.punched_at at time zone selected_device.timezone)::date = local_date;

    -- May chi ghi gio vao: KHONG suy ra gio ra tu lan quet cuoi. Lan quet thu
    -- hai o may nay hau het la quet lai sau vai phut, dung lam gio ra thi bao
    -- cao se noi nguoi do lam 5 phut.
    if selected_device.records_checkout then
      resolved_out := case
        when explicit_out is not null then explicit_out
        when event_count >= 2 and last_punch > first_punch then last_punch
        else null end;
      resolved_status := case when resolved_out is not null then 'completed' else 'active' end;
    else
      resolved_out := null;
      -- Da quet la da di lam hom do; may se khong gui them gi cho ngay nay nua.
      resolved_status := 'completed';
    end if;

    select * into existing_attendance
    from public.attendance a
    where a.user_id = work_item.profile_id and a.date = local_date
    for update;

    if existing_attendance.id is null then
      insert into public.attendance(
        user_id, date, check_in_time, check_out_time, status, approved_by_lead,
        location_id, check_in_method, anomaly_flags
      ) values (
        work_item.profile_id, local_date, first_punch, resolved_out, resolved_status,
        true, selected_device.location_id, 'DEVICE', '{}'
      );
    elsif coalesce(existing_attendance.check_in_method, 'DEVICE') = 'DEVICE' then
      update public.attendance
      set check_in_time = least(coalesce(check_in_time, first_punch), first_punch),
          check_out_time = case
            when resolved_out is not null
              then greatest(coalesce(check_out_time, resolved_out), resolved_out)
            else check_out_time end,
          status = case when resolved_status = 'completed' then 'completed' else status end,
          location_id = coalesce(location_id, selected_device.location_id),
          check_in_method = 'DEVICE',
          approved_by_lead = true
      where id = existing_attendance.id;
    elsif resolved_out is not null and resolved_out > existing_attendance.check_in_time then
      -- Nhan vien check-in bang GPS, may vat ly bo sung gio ra.
      update public.attendance
      set check_out_time = greatest(coalesce(check_out_time, resolved_out), resolved_out),
          status = 'completed'
      where id = existing_attendance.id;
    end if;

    update public.attendance_device_events
    set processed_at = now(), processing_error = null
    where device_id = selected_device.id and profile_id = work_item.profile_id
      and (punched_at at time zone selected_device.timezone)::date = local_date
      and processed_at is null;
  end loop;

  -- processed_count phai la tong, tinh lai de tranh gia tri cua vong lap cuoi.
  select count(*) into processed_count from public.attendance_device_events
  where device_id = selected_device.id and received_at >= (select started_at from public.attendance_device_sync_runs where id = sync_id)
    and processed_at is not null;

  update public.attendance_device_tokens set last_used_at = now() where id = selected_token.id;
  update public.attendance_devices
  set last_seen_at = now(), last_sync_at = now(),
      last_sync_status = case when unmapped_count > 0 then 'PARTIAL' else 'SUCCESS' end,
      last_sync_message = case when unmapped_count > 0
        then unmapped_count || ' ma nhan vien chua duoc anh xa.' else inserted_count || ' su kien moi.' end,
      updated_at = now()
  where id = selected_device.id;
  update public.attendance_device_sync_runs
  set finished_at = now(), status = case when unmapped_count > 0 then 'PARTIAL' else 'SUCCESS' end,
      inserted_count = ingest_attendance_device_events.inserted_count,
      processed_count = ingest_attendance_device_events.processed_count,
      unmapped_count = ingest_attendance_device_events.unmapped_count,
      message = case when unmapped_count > 0 then 'Co ma nhan vien chua anh xa.' else 'Dong bo thanh cong.' end
  where id = sync_id;

  return jsonb_build_object(
    'sync_id', sync_id, 'received', received_count, 'inserted', inserted_count,
    'processed', processed_count, 'unmapped', unmapped_count,
    'status', case when unmapped_count > 0 then 'PARTIAL' else 'SUCCESS' end
  );
exception when others then
  if sync_id is not null then
    update public.attendance_device_sync_runs
    set finished_at = now(), status = 'ERROR', message = sqlerrm where id = sync_id;
    update public.attendance_devices
    set last_sync_at = now(), last_sync_status = 'ERROR', last_sync_message = sqlerrm, updated_at = now()
    where id = selected_device.id;
  end if;
  raise;
end;
$$;

revoke all on function public.ingest_attendance_device_events(text, jsonb) from public;
grant execute on function public.ingest_attendance_device_events(text, jsonb) to anon, authenticated;
