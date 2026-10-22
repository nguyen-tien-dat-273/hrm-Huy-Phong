-- Cach ket noi cua tung may: BRIDGE (may tinh trong LAN doc cong 4370) hay ADMS
-- (may tu day len HRM qua Internet, khong can may tinh trung gian).
-- Chay lai nhieu lan duoc.

alter table public.attendance_devices
  add column if not exists sync_mode text not null default 'BRIDGE';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_devices_sync_mode_check') then
    alter table public.attendance_devices
      add constraint attendance_devices_sync_mode_check check (sync_mode in ('BRIDGE', 'ADMS'));
  end if;
end $$;

comment on column public.attendance_devices.sync_mode is
  'BRIDGE = may tinh trong LAN doc may; ADMS = may tu day du lieu len /iclock.';

-- ----------------------------------------------------------------------------
-- May ADMS hoi lenh moi ~60 giay mot lan (getrequest). Moi lan do ghi nhan
-- last_seen_at de HRM phan biet "may mat ket noi" voi "chua ai cham cong".
-- Truoc day last_seen_at chi nhich khi co lan quet, nen may im lang nhin giong
-- het may hong. Xac thuc bang token giong claim_attendance_device_sync, nhung
-- KHONG dung co sync_requested_at - ADMS khong co ai nhan co do.
-- ----------------------------------------------------------------------------
create or replace function public.touch_attendance_device(bridge_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_device uuid;
begin
  if bridge_token is null or length(bridge_token) < 20 then
    perform public.record_attendance_device_auth_failure();
    return jsonb_build_object('ok', false, 'code', 'AUTH_FAILED');
  end if;

  v_hash := encode(digest(bridge_token, 'sha256'), 'hex');
  select t.device_id into v_device
  from public.attendance_device_tokens t
  join public.attendance_devices d on d.id = t.device_id
  where t.token_hash = v_hash
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
    and d.is_active
  limit 1;
  if v_device is null then
    perform public.record_attendance_device_auth_failure();
    return jsonb_build_object('ok', false, 'code', 'AUTH_FAILED');
  end if;

  update public.attendance_devices set last_seen_at = now() where id = v_device;
  update public.attendance_device_tokens set last_used_at = now() where token_hash = v_hash;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.touch_attendance_device(text) from public;
grant execute on function public.touch_attendance_device(text) to anon, authenticated;
