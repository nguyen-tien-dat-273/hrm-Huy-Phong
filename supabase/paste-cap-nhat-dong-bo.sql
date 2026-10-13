-- ============================================================================
-- CAP NHAT DONG BO MAY CHAM CONG - dan ca file vao Supabase > SQL Editor > Run.
-- ----------------------------------------------------------------------------
-- QUAN TRONG: bo boi den truoc khi bam Run. SQL Editor chi chay phan dang duoc
-- chon; chay thieu phan dau se ra loi "relation ... does not exist".
--
--   PHAN A  Sua ham nap su kien (hai loi: ambiguous + missing FROM-clause).
--   PHAN B  Nut "Dong bo ngay" tren HRM va moc bao danh cua bridge.
--
-- Chay lai nhieu lan deu duoc.
-- ============================================================================


-- ############################ PHAN A ########################################

-- ============================================================================
-- Sua that su loi chan moi lan dong bo cua ingest_attendance_device_events().
-- ----------------------------------------------------------------------------
-- Ham nay hong HAI lop; lop thu hai chi lo ra sau khi va lop thu nhat:
--
--  1. 'column reference "unmapped_count" is ambiguous'
--     Bang attendance_device_sync_runs CO cot ten unmapped_count, ma than ham
--     cung khai bien trung ten. Trong cau update len bang do, PostgreSQL khong
--     biet nen hieu la cot hay bien.
--
--  2. 'missing FROM-clause entry for table "ingest_attendance_device_events"'
--     Ban goc dinh danh bien bang ten ham:
--       inserted_count = ingest_attendance_device_events.inserted_count
--     Cach do KHONG dung o day - PostgreSQL hieu tien to la mot TEN BANG trong
--     FROM. Ba dong kieu nay co tu migration 20260926100000 va chua bao gio
--     chay duoc; khong ai thay vi loi ambiguous o tren da chan truoc.
--
-- Cach sua: doi ten BIEN cho khac han ten COT (v_received, v_inserted,
-- v_processed, v_unmapped). Het nhap nhang, khong can #variable_conflict, va
-- doc lai thi ro ngay dau la bien dau la cot. Ve trai cua SET va danh sach cot
-- cua INSERT giu nguyen ten cot that.
--
-- Phan con lai cua than ham giu nguyen so voi 20260930230000.
-- Chay lai nhieu lan duoc.
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

revoke all on function public.ingest_attendance_device_events(text, jsonb) from public;
grant execute on function public.ingest_attendance_device_events(text, jsonb) to anon, authenticated;


-- ############################ PHAN B ########################################

-- ============================================================================
-- Bam "Dong bo ngay" tu HRM, va cho HRM biet bridge con song hay khong.
-- ----------------------------------------------------------------------------
-- Van de: website chay tren Vercel, khong the voi toi 192.168.x.x cua may cham
-- cong. Muon dong bo thi phai mo terminal tren may trong LAN go lenh - khong ai
-- lam duoc viec do hang ngay.
--
-- Cach giai: dao chieu. HRM khong goi xuong may cham cong; no chi DAT MOT CO
-- (`sync_requested_at`). Bridge von da chay san trong LAN se hoi co do vai chuc
-- giay mot lan, thay co thi doc may ngay lap tuc. Nguoi dung thay nhu la bam
-- nut xong vai giay sau co du lieu.
--
-- Them `last_seen_at` duoc cap nhat moi lan bridge hoi: tu nay HRM phan biet
-- duoc "bridge chet" voi "bridge song nhung may cham cong tat" - truoc day hai
-- truong hop nay nhin giong het nhau tren man hinh.
--
-- Chay lai nhieu lan duoc.
-- ============================================================================

alter table public.attendance_devices
  add column if not exists sync_requested_at timestamptz;

comment on column public.attendance_devices.sync_requested_at is
  'Khac null = co nguoi bam "Dong bo ngay" va bridge chua nhan lenh. Bridge xoa ve null khi nhan.';

-- ----------------------------------------------------------------------------
-- HRM dat co. Chi Admin/CEO, dung chuan voi cac RPC khac cua phan he nay.
-- ----------------------------------------------------------------------------
create or replace function public.request_attendance_device_sync(target_device uuid)
returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare stamp timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Chi Admin/CEO duoc yeu cau dong bo.' using errcode = '42501';
  end if;

  update public.attendance_devices
  set sync_requested_at = now(), updated_at = now()
  where id = target_device and is_active
  returning sync_requested_at into stamp;

  if stamp is null then
    raise exception 'May cham cong khong ton tai hoac da tat.' using errcode = '22023';
  end if;
  return stamp;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bridge hoi lenh. Xac thuc bang chinh token bridge, khong dung phien dang nhap.
-- ----------------------------------------------------------------------------
create or replace function public.claim_attendance_device_sync(bridge_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  token_row public.attendance_device_tokens%rowtype;
  claimed boolean;
begin
  if bridge_token is null or length(bridge_token) < 20 then
    raise exception 'Khoa bridge khong hop le.' using errcode = '28000';
  end if;

  select t.* into token_row
  from public.attendance_device_tokens t
  join public.attendance_devices d on d.id = t.device_id
  where t.token_hash = encode(digest(bridge_token, 'sha256'), 'hex')
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
    and d.is_active
  limit 1;
  if token_row.id is null then
    raise exception 'Khoa bridge sai, het han hoac da bi thu hoi.' using errcode = '28000';
  end if;

  -- Nhan lenh va xoa co trong CUNG mot cau lenh. Neu tach lam hai thi hai bridge
  -- chay song song se cung thay co va cung doc may mot luc - may chi phuc vu mot
  -- ket noi nen mot trong hai se bao mat ket noi.
  update public.attendance_devices
  set sync_requested_at = null, last_seen_at = now()
  where id = token_row.device_id and sync_requested_at is not null
  returning true into claimed;

  if claimed is null then
    claimed := false;
    -- Khong co lenh, nhung van phai ghi nhan bridge con song.
    update public.attendance_devices set last_seen_at = now()
    where id = token_row.device_id;
  end if;

  update public.attendance_device_tokens set last_used_at = now() where id = token_row.id;
  return jsonb_build_object('sync_requested', claimed);
end;
$$;

revoke all on function public.request_attendance_device_sync(uuid) from public;
revoke all on function public.claim_attendance_device_sync(text) from public;
grant execute on function public.request_attendance_device_sync(uuid) to authenticated;
grant execute on function public.claim_attendance_device_sync(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Cho Admin/CEO doc duoc lich su dong bo. Bang da co policy SELECT tu
-- 20260926100000; them o day la de chac chan khi chay tren database chua co.
-- ----------------------------------------------------------------------------
drop policy if exists attendance_device_sync_runs_admin on public.attendance_device_sync_runs;
create policy attendance_device_sync_runs_admin on public.attendance_device_sync_runs
  for select to authenticated using (public.is_admin());
