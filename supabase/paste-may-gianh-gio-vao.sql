-- ============================================================================
-- DAN CA FILE NAY vao Supabase > SQL Editor. BAM Ctrl+A TRUOC KHI RUN.
-- ============================================================================

-- ============================================================================
-- Check-in tren HRM truoc, quet may sau: lay gio theo MAY.
-- ----------------------------------------------------------------------------
-- Truoc thay doi nay, nhanh xu ly truong hop do la:
--
--   elsif resolved_out is not null and resolved_out > existing_attendance.check_in_time then
--     update ... set check_out_time = ..., status = 'completed'
--
-- Nghia la may chi duoc phep BO SUNG GIO RA cho dong tu khai. Nhung may nay
-- khong bao gio gui gio ra (records_checkout = false nen resolved_out luon
-- null), nen dieu kien khong bao gio dung - lan quet bi BO QUA HOAN TOAN.
-- Ngay cong giu nguyen gio tu khai, va van phai cho quan ly xac nhan.
--
-- Sua: may gianh lay dong do. Gio vao lay theo may, nguon doi sang DEVICE nen
-- trigger attendance_00_device_state tu tinh cong khi co gio ra. Gio ra da bam
-- tren HRM thi giu nguyen.
--
-- Phan con lai cua than ham giong het 20261007140000.
-- Ham mang hau to _validated vi migration bao mat 20261007113000 da dung mot
-- lop boc cung ten o ngoai; sua vao lop trong de khong pha lop boc.
--
-- Chay lai nhieu lan duoc.
-- ============================================================================

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

  select count(*) into v_unmapped
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
    where device_id = selected_device.id and profile_id = work_item.profile_id
      and (punched_at at time zone selected_device.timezone)::date = local_date
      and processed_at is null;
  end loop;

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
      message = case when v_unmapped > 0 then 'Co ma nhan vien chua anh xa.' else 'Dong bo thanh cong.' end
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
