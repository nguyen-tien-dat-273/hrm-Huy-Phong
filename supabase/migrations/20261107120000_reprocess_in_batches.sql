-- ============================================================================
-- Xu ly lai khong con het gio cho: chia ngay cong thanh tung lo nho.
-- ----------------------------------------------------------------------------
-- Loi: "canceling statement due to statement timeout". Nut Xu ly lai chay het
-- hang tram ngay cong trong MOT cau lenh; moi ngay la mot lan ghi vao attendance
-- (kem nhieu trigger: ky cong, nghi phep, luong) nen vuot gioi han thoi gian cua
-- tai khoan dang nhap. Cac cau loc theo ngay con ep kieu ::date nen khong dung chi muc.
--
-- Nay:
--   * map_attendance_device_pending      : ghep ma cho cac lan quet cho, theo tung MA khac
--                                          nhau (vai chuc) thay vi tung dong (hang nghin).
--   * process_attendance_device_pending  : dung ngay cong tu cac lan quet da ghep; nhan
--                                          p_max_days de xu ly tung lo, tra ve so ngay con lai.
--                                          Ngay cu xu ly truoc. Loc theo khoang thoi gian
--                                          nen dung duoc chi muc moi them.
--   * ingest_attendance_device_events_validated goi lai hai ham tren (khong gioi han) nen
--     chi con MOT ban logic: may gui lo moi hay bam nut deu di chung mot duong.
--   * reprocess_attendance_device(target, max_days) : xu ly mot lo roi tra ve
--     {days, locked, remaining, unmapped}; man hinh goi lai cho toi khi remaining = 0.
-- Hai ham dung chung KHONG cap cho nguoi dung: chi ham khac goi duoc.
-- Chay lai nhieu lan duoc.
-- ============================================================================

create index if not exists attendance_device_events_profile_day_idx
  on public.attendance_device_events(device_id, profile_id, punched_at);

create or replace function public.map_attendance_device_pending(p_device uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- Thu tu uu tien: (1) mapping khai bao, (2) employee_code trung chu, (3) so cuoi cua
  -- employee_code trung ma so tren may (23 <-> NV023) khi chi co dung mot nguoi khop.
  -- Ghep theo tung MA khac nhau (vai chuc) thay vi tung dong (hang nghin).
  update public.attendance_device_events e
  set profile_id = x.pid,
      processing_error = case when x.pid is null then 'UNMAPPED_USER' else null end
  from (
    select c.code, coalesce(m.profile_id, p.id, n.id) as pid
    from (
      select distinct d.device_user_id as code
      from public.attendance_device_events d
      where d.device_id = p_device and d.processed_at is null and d.profile_id is null
    ) c
    left join public.attendance_device_mappings m
      on m.device_id = p_device and m.device_user_id = c.code
    left join public.profiles p
      on lower(p.employee_code) = lower(c.code) and p.is_active
    left join lateral (
      select (array_agg(q.id))[1] as id
      from public.profiles q
      where q.is_active
        and c.code ~ '^[0-9]+$'
        and public.attendance_code_number(q.employee_code) = public.attendance_code_number(c.code)
      having count(*) = 1
    ) n on true
  ) x
  where e.device_id = p_device and e.processed_at is null and e.profile_id is null
    and e.device_user_id = x.code
    and (x.pid is not null or e.processing_error is distinct from 'UNMAPPED_USER');
end;
$$;

revoke all on function public.map_attendance_device_pending(uuid) from public, anon, authenticated;

create or replace function public.process_attendance_device_pending(
  p_device uuid,
  p_max_days integer default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  selected_device public.attendance_devices%rowtype;
  work_item record;
  existing_attendance public.attendance%rowtype;
  first_punch timestamptz;
  last_punch timestamptz;
  explicit_out timestamptz;
  event_count integer;
  local_date date;
  day_start timestamptz;
  day_end timestamptz;
  resolved_out timestamptz;
  resolved_status text;
  v_days integer := 0;
  v_locked integer := 0;
  v_remaining integer;
begin
  select * into selected_device from public.attendance_devices where id = p_device;
  if selected_device.id is null then
    raise exception 'May cham cong khong ton tai.' using errcode = '22023';
  end if;

  for work_item in
    select distinct e.profile_id,
      (e.punched_at at time zone selected_device.timezone)::date as work_date
    from public.attendance_device_events e
    where e.device_id = p_device and e.processed_at is null and e.profile_id is not null
    order by 2, 1
    limit p_max_days
  loop
    local_date := work_item.work_date;
    day_start := local_date::timestamp at time zone selected_device.timezone;
    day_end := (local_date + 1)::timestamp at time zone selected_device.timezone;

    -- Ky cong da khoa: khong dung vao ngay cong (trigger se chan va lam hong ca lo,
    -- may thu lai mai). Chi giu log tho, danh dau da xu ly de khong xet lai.
    if exists (
      select 1 from public.timesheet_periods p
      where p.status = 'LOCKED'
        and local_date between p.month_start and (p.month_start + interval '1 month - 1 day')::date
    ) then
      update public.attendance_device_events
      set processed_at = now(), processing_error = 'PERIOD_LOCKED'
      where device_id = p_device and profile_id = work_item.profile_id
        and punched_at >= day_start and punched_at < day_end
        and processed_at is null;
      v_locked := v_locked + 1;
      continue;
    end if;
    select min(e.punched_at), max(e.punched_at),
      max(e.punched_at) filter (where e.punch_type in ('OUT', 'BREAK_OUT')),
      count(*)
    into first_punch, last_punch, explicit_out, event_count
    from public.attendance_device_events e
    where e.device_id = p_device and e.profile_id = work_item.profile_id
      and punched_at >= day_start and punched_at < day_end;

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
    else
      -- Nguoi nay da tu check-in tren HRM, sau do moi quet may. May la nguon
      -- dang tin hon: no chung minh nguoi do co mat that tai cho, con dong tu
      -- khai thi khong. Nen MAY GIANH LAY dong do - gio vao lay theo may, va
      -- nguon doi sang DEVICE nen ngay cong khong con phai cho quan ly xac
      -- nhan nua.
      --
      -- Giu lai gio ra neu nguoi do da bam checkout tren HRM; may nay khong
      -- gui gio ra nen khong co gi de ghi de.
      update public.attendance
      set check_in_time = first_punch,
          check_in_method = 'DEVICE',
          location_id = coalesce(location_id, selected_device.location_id),
          check_out_time = case
            when resolved_out is not null
              then greatest(coalesce(check_out_time, resolved_out), resolved_out)
            else check_out_time end
      where id = existing_attendance.id;
    end if;

    update public.attendance_device_events
    set processed_at = now(), processing_error = null
    where device_id = p_device and profile_id = work_item.profile_id
      and punched_at >= day_start and punched_at < day_end
      and processed_at is null;
    v_days := v_days + 1;
  end loop;

  select count(*) into v_remaining from (
    select distinct e.profile_id, (e.punched_at at time zone selected_device.timezone)::date
    from public.attendance_device_events e
    where e.device_id = p_device and e.processed_at is null and e.profile_id is not null
  ) r;

  return jsonb_build_object('days', v_days, 'locked', v_locked, 'remaining', v_remaining);
end;
$$;

revoke all on function public.process_attendance_device_pending(uuid, integer) from public, anon, authenticated;

create or replace function public.ingest_attendance_device_events_validated(
  bridge_token text,
  events jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  selected_token public.attendance_device_tokens%rowtype;
  selected_device public.attendance_devices%rowtype;
  sync_id uuid;
  v_received integer := 0;
  v_inserted integer := 0;
  v_processed integer := 0;
  v_unmapped integer := 0;
  v_locked integer := 0;
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

  v_received := jsonb_array_length(events);
  if v_received > 5000 then
    raise exception 'Moi lan dong bo toi da 5000 su kien.' using errcode = '54000';
  end if;
  insert into public.attendance_device_sync_runs(device_id, received_count)
  values (selected_device.id, v_received) returning id into sync_id;

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
  ) select count(*) into v_inserted from inserted;

  perform public.map_attendance_device_pending(selected_device.id);

  select count(*) into v_unmapped
  from public.attendance_device_events
  where device_id = selected_device.id and processed_at is null and profile_id is null;

  v_locked := coalesce((public.process_attendance_device_pending(selected_device.id, null) ->> 'locked')::integer, 0);

  -- Tong so da xu ly phai tinh lai, tinh lai de tranh gia tri cua vong lap cuoi.
  select count(*) into v_processed from public.attendance_device_events
  where device_id = selected_device.id and received_at >= (select started_at from public.attendance_device_sync_runs where id = sync_id)
    and processed_at is not null;

  update public.attendance_device_tokens set last_used_at = now() where id = selected_token.id;
  update public.attendance_devices
  set last_seen_at = now(), last_sync_at = now(),
      last_sync_status = case when v_unmapped > 0 then 'PARTIAL' else 'SUCCESS' end,
      last_sync_message = case when v_unmapped > 0
        then v_unmapped || ' ma nhan vien chua duoc anh xa.' else v_inserted || ' su kien moi.' end,
      updated_at = now()
  where id = selected_device.id;
  update public.attendance_device_sync_runs
  set finished_at = now(), status = case when v_unmapped > 0 then 'PARTIAL' else 'SUCCESS' end,
      inserted_count = v_inserted,
      processed_count = v_processed,
      unmapped_count = v_unmapped,
      message = (case when v_unmapped > 0 then 'Co ma nhan vien chua anh xa.' else 'Dong bo thanh cong.' end)
        || (case when v_locked > 0 then ' ' || v_locked || ' ngay thuoc ky cong da khoa nen chi luu log.' else '' end)
  where id = sync_id;

  return jsonb_build_object(
    'sync_id', sync_id, 'received', v_received, 'inserted', v_inserted,
    'processed', v_processed, 'unmapped', v_unmapped,
    'status', case when v_unmapped > 0 then 'PARTIAL' else 'SUCCESS' end
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

revoke all on function public.ingest_attendance_device_events_validated(text, jsonb) from public, anon;
grant execute on function public.ingest_attendance_device_events_validated(text, jsonb) to authenticated;

drop function if exists public.reprocess_attendance_device(uuid);

create or replace function public.reprocess_attendance_device(
  target_device uuid,
  max_days integer default 25
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_result jsonb;
  v_unmapped integer;
begin
  if not public.is_admin() then
    raise exception 'Chi Admin/CEO duoc xu ly lai du lieu may cham cong.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.attendance_devices d where d.id = target_device and d.is_active) then
    raise exception 'May cham cong khong ton tai hoac da tat.' using errcode = '22023';
  end if;

  perform public.map_attendance_device_pending(target_device);
  v_result := public.process_attendance_device_pending(target_device, greatest(coalesce(max_days, 25), 1));

  select count(*) into v_unmapped
  from public.attendance_device_events
  where device_id = target_device and processed_at is null and profile_id is null;

  return v_result || jsonb_build_object('unmapped', v_unmapped);
end;
$$;

revoke all on function public.reprocess_attendance_device(uuid, integer) from public, anon;
grant execute on function public.reprocess_attendance_device(uuid, integer) to authenticated;
